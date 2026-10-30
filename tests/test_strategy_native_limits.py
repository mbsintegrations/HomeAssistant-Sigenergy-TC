from datetime import timedelta

import pytest
from test_control_session import setup

from custom_components.sigen_hybrid.core.errors import SafetyError
from custom_components.sigen_hybrid.core.models import Intent, Mode, Source
from custom_components.sigen_hybrid.core.owner_devices import system_inventory


def test_inventory_requires_real_identities_and_explicit_charger_presence():
    tree={"nodeList":[{"deviceType":2,"snCode":"INVERTER-1","nodeList":[{"deviceType":4,"snCode":"BAT-1"}]}]}
    result=system_inventory(tree,{"hasAcCharger":False,"hasEv":False,"dcSnList":["INVERTER-1"],"hasGateway":True,"pvCapacity":10})
    assert {item['type'] for item in result}=={'inverter','battery_module','ac','dc','gateway','solar'}
    assert all(item['installed'] is False for item in result if item['type'] in ('ac','dc'))
    assert not any(item['type']=='optimizer' for item in result)
    assert system_inventory(None,{"dcSnList":["INVERTER-1"]})==[]


async def test_a_delayed_resume_cannot_clear_a_newer_owner_pause():
    clock, _, _, journal, _, _, _=setup()
    requested=clock[0]-timedelta(seconds=1)
    await journal.apply('owner',[('battery_export_block',True)],context={'pause_automation':True})
    assert (await journal.automation_pause(clear=True,if_not_after=requested))['paused'] is True
    assert (await journal.automation_pause(clear=True,if_not_after=clock[0]+timedelta(seconds=1)))['paused'] is False


async def test_deadline_is_adjusted_after_queue_delay_and_journal_records_actual_sent_duration():
    clock, appliance, store, journal, session, controller, snapshot=setup()
    intent=Intent(Mode.HOLD,source=Source.AUTOMATION,duration_minutes=15,deadline=clock[0]+timedelta(minutes=15),strategy_id='r',request_id='deadline')
    real_preflight=journal.provider.preflight
    def delayed(*args):
        clock[0]+=timedelta(seconds=90)
        return real_preflight(*args)
    journal.provider.preflight=delayed
    await controller.execute(intent,snapshot,clock[0],dry_run=False)
    manual=next(item for item in store.value['active']['steps'] if item['key']=='manual')
    assert manual['requested']['duration_minutes']==13
    assert appliance.manual['endTime']<=intent.deadline.timestamp()


async def test_grid_owner_limit_is_read_back_and_restored_without_touching_installer_limit():
    clock, appliance, _, journal, _, _, _=setup()
    limits={"enable":True,"maxLimitation":0,"maxLimitationOwner":0,"maxLimitationInstaller":5}
    old_read,old_write=appliance._data,appliance._envelope
    async def read(method,path,**kwargs):
        if '/grid/limitation/export/' in path:
            return dict(limits)
        return await old_read(method,path,**kwargs)
    async def write(method,path,**kwargs):
        if path.endswith('/grid/limitation/export'):
            appliance.calls.append((method,path,kwargs))
            assert kwargs['json']['maxLimitationInstaller'] is None
            limits.update(enable=kwargs['json']['enable'],maxLimitationOwner=float(kwargs['json']['maxLimitationOwner']))
            return {'code':0,'data':True}
        return await old_write(method,path,**kwargs)
    appliance._data,appliance._envelope=read,write
    await journal.apply('grid', [('grid_export_limit',{'enabled':True,'limit_kw':3})], expires_at=clock[0]+timedelta(minutes=15))
    assert limits['maxLimitationOwner']==3 and limits['maxLimitationInstaller']==5
    await journal.restore()
    assert limits['maxLimitationOwner']==0 and limits['maxLimitationInstaller']==5
    with pytest.raises(SafetyError):
        await journal.apply('too-high',[('grid_export_limit',{'enabled':True,'limit_kw':6})])
    assert limits['maxLimitationOwner']==0
