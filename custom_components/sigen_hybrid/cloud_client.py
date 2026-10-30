"""Create the optional client outside HA's event loop (crypto loads native code)."""

from homeassistant.helpers.aiohttp_client import async_get_clientsession

# Upstream sigenergy-cloud's HA adapter documents this compatibility header:
# https://github.com/solidfox/homeassistant-sigenergy-cloud/blob/main/custom_components/sigenergy/const.py
CLOUD_USER_AGENT = "homeassistant-sigenergy/0.1.2"
# Verified owner-web request context. These are public client metadata, not
# credentials, permissions or a reused browser session.
CLOUD_OWNER_CONTEXT = {
    "AUTH-CLIENT-ID": "sigen",
    "VERSION": "RELEASE",
    "lang": "en_US",
    "sg-app-version": "4.1.0",
    "sg-env": "1",
    "sg-pkg": "sigen_app",
    "sg-platform": "web",
    "sg-source": "flutterweb",
    "sg-v": "4.1.0",
}


class CloudSession:
    """Add the cloud gateway header per request, preserving HA's shared session."""

    def __init__(self, session, *, region=None, gate=None):
        if region is not None and region not in ("eu", "us", "apac", "cn"):
            raise ValueError("Unsupported cloud region")
        self._session = session
        self.gate = gate
        self._context = {**CLOUD_OWNER_CONTEXT, "client-server": region} if region is not None else {}

    @staticmethod
    def _headers(kwargs, context=None):
        headers = dict(kwargs.get("headers") or {})
        present = {str(name).lower() for name in headers}
        for name, value in {"User-Agent": CLOUD_USER_AGENT, **(context or {})}.items():
            if name.lower() not in present:
                headers[name] = value
        return {**kwargs, "headers": headers}

    def post(self, url, **kwargs):
        return (
            self.gate.request(self._session, "POST", url, **self._headers(kwargs, self._context))
            if self.gate
            else self._session.post(url, **self._headers(kwargs, self._context))
        )

    def request(self, method, url, **kwargs):
        return (
            self.gate.request(self._session, method, url, **self._headers(kwargs, self._context))
            if self.gate
            else self._session.request(method, url, **self._headers(kwargs, self._context))
        )


def _create_client(username, password, region, session):
    from sigenergy_cloud import SigenergyCloudClient

    from .core.cloud_requests import SerialCloudTransport
    from .core.owner_devices import OwnerDeviceReads

    client = SigenergyCloudClient(username, password, region=region, session=session)
    if hasattr(client, "_transport"):
        client._transport = SerialCloudTransport(client._transport)
    result = OwnerDeviceReads(client)
    result.request_gate = session.gate
    return result


async def async_create_cloud_client(hass, credentials, *, reauthenticate=False):
    import asyncio
    from hashlib import sha256

    from .const import DOMAIN
    from .core.cloud_requests import CloudRequestGate

    username, region = credentials["username"].strip(), credentials["region"]
    account = sha256((region + ":" + username).encode()).hexdigest()
    identity = sha256((account + ":" + credentials["password"]).encode()).hexdigest()
    shared = hass.data.setdefault(DOMAIN, {}).setdefault("cloud_accounts", {})
    state = shared.setdefault(account, {"gate": CloudRequestGate()})
    gate = state["gate"]
    state.setdefault("lock", asyncio.Lock())
    async with state["lock"]:
        if reauthenticate:
            gate.resume_authentication()
        if (
            not reauthenticate
            and state.get("identity") == identity
            and state.get("client") is not None
            and not (gate.auth_blocked and gate.status["cooldown_seconds"] == 0)
        ):
            return state["client"]
        if gate.auth_blocked and gate.status["cooldown_seconds"] == 0:
            gate.auth_blocked = False
        session = CloudSession(async_get_clientsession(hass), region=region, gate=gate)
        client = await hass.async_add_executor_job(_create_client, username, credentials["password"], region, session)
        state.update(identity=identity, client=client)
        return client
