import asyncio
import struct
import sys

import pytest
from pymodbus.client import AsyncModbusTcpClient

from custom_components.sigen_hybrid.core.errors import ConfirmationError, SafetyError, TransportError
from custom_components.sigen_hybrid.core.modbus import ModbusTransport
from custom_components.sigen_hybrid.core.registers import (
    ENERGY_REGISTERS,
    READ_REGISTERS,
    WRITE_REGISTERS,
    Register,
    optional_limit,
)


def test_signed_power_decode_encode_and_unset_limit():
    reg = Register(1, 2, 1000, signed=True)
    assert reg.decode(reg.encode(-1.234)) == -1.234
    assert optional_limit(4294967.295) is None
    assert optional_limit(3) == 3
    with pytest.raises(ValueError):
        reg.decode([1])


def test_write_allowlist_excludes_export_and_infrastructure_commands():
    assert {r.address for r in WRITE_REGISTERS.values()} == {40029, 40031, 40032, 40034, 40046, 40047, 40048}
    assert READ_REGISTERS["home_kw"].address == 30282


async def test_real_modbus_tcp_write_uses_exact_address_then_fresh_readback():
    requests = []
    registers = {40031: 0}

    async def serve(reader, writer):
        try:
            while True:
                header = await reader.readexactly(7)
                transaction, protocol, length, unit = struct.unpack(">HHHB", header)
                pdu = await reader.readexactly(length - 1)
                function, address, count = struct.unpack(">BHH", pdu[:5])
                requests.append((function, address, unit))
                if function == 16:
                    registers[address] = struct.unpack(">H", pdu[6:8])[0]
                    response = struct.pack(">BHH", function, address, count)
                else:
                    response = bytes([function, count * 2]) + b"".join(
                        struct.pack(">H", registers.get(address + i, 0)) for i in range(count)
                    )
                writer.write(struct.pack(">HHHB", transaction, protocol, len(response) + 1, unit) + response)
                await writer.drain()
        except asyncio.IncompleteReadError:
            pass
        finally:
            writer.close()
            await writer.wait_closed()

    server = await asyncio.start_server(serve, "127.0.0.1", 0)
    client = AsyncModbusTcpClient("127.0.0.1", port=server.sockets[0].getsockname()[1], retries=0)
    try:
        assert await client.connect()
        transport = ModbusTransport(client)
        await transport.write_confirmed("remote_mode", 2)
        assert requests == [(16, 40031, 247), (3, 40031, 247)]
    finally:
        client.close()
        server.close()
        await server.wait_closed()


class FakeResponse:
    registers = [9]

    def isError(self):
        return False


class FakeClient:
    def __init__(self, fail=False):
        self.fail = fail
        self.writes = []

    async def write_registers(self, **kwargs):
        self.writes.append(kwargs)
        if self.fail:
            raise TimeoutError("PRIVATE device details must not escape")
        return FakeResponse()

    async def read_holding_registers(self, **kwargs):
        return FakeResponse()


async def test_write_timeout_does_not_retry_or_guess_offset():
    client = FakeClient(fail=True)
    with pytest.raises(TransportError) as exc:
        await ModbusTransport(client).write_confirmed("remote_mode", 2)
    assert len(client.writes) == 1 and client.writes[0]["address"] == 40031
    assert "PRIVATE" not in str(exc.value)


async def test_mismatching_readback_does_not_claim_confirmation():
    with pytest.raises(ConfirmationError):
        await ModbusTransport(FakeClient()).write_confirmed("remote_mode", 2)


async def test_shared_reader_rejects_writes_before_any_device_request():
    client = FakeClient()
    transport = ModbusTransport(client, read_only=True)
    with pytest.raises(SafetyError, match="read-only"):
        await transport.write_confirmed("remote_mode", 2)
    assert client.writes == []
    assert transport.trace["write_requests"] == 0


async def test_snapshot_groups_only_adjacent_allowlisted_registers_and_records_read_trace(monkeypatch):
    values = {key: 0 for key in READ_REGISTERS}
    values.update(soc=50, max_active_kw=5, max_charge_kw=5, max_discharge_kw=5, capacity_kwh=36, running_state=1)
    values.update(remote_ems=0, remote_mode=2, backup_soc=10, charge_cutoff_soc=100, discharge_cutoff_soc=10)
    values.update({key: 123.45 for key in ENERGY_REGISTERS})
    words, allowed = {}, set()
    for key, value in values.items():
        reg = READ_REGISTERS.get(key) or ENERGY_REGISTERS.get(key) or WRITE_REGISTERS[key]
        for offset, word in enumerate(reg.encode(value)):
            words[(reg.holding, reg.address + offset)] = word
            allowed.add((reg.holding, reg.address + offset))

    class Reader:
        calls = []

        async def read(self, holding, **kwargs):
            self.calls.append((holding, kwargs))
            assert kwargs["device_id"] == 247
            response = FakeResponse()
            response.registers = [words[(holding, kwargs["address"] + offset)] for offset in range(kwargs["count"])]
            return response

        async def read_input_registers(self, **kwargs):
            return await self.read(False, **kwargs)

        async def read_holding_registers(self, **kwargs):
            return await self.read(True, **kwargs)

    async def no_wait(_):
        pass

    monkeypatch.setattr(sys.modules[ModbusTransport.__module__].asyncio, "sleep", no_wait)
    client = Reader()
    transport = ModbusTransport(client, read_only=True)
    snapshot = await transport.snapshot()
    assert snapshot.soc == 50 and snapshot.capacity_kwh == 36
    assert len(client.calls) == 15
    assert snapshot.energy == {key: 123.45 for key in ENERGY_REGISTERS}
    requested = {
        (holding, call["address"] + offset) for holding, call in client.calls for offset in range(call["count"])
    }
    assert requested == allowed
    assert transport.trace["read_requests"] == 15 and transport.trace["snapshots"] == 1
    assert transport.trace["errors"] == 0 and transport.trace["write_requests"] == 0
