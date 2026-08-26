from __future__ import annotations
import unittest
from barco_controller.services.workplace import WorkplaceController

class FakeApi:
    def __init__(self): self.calls=[]
    def request(self, method, path, *, params=None, json_body=None):
        self.calls.append((method,path,params))
        if path == '/operate/v3/workplaces': return {'items':[{'id':'wp-1','name':'Wall 1'}]}
        if path == '/operate/v3/sources': return {'data':[{'id':'src-1','name':'Renderer VNC'}]}
        if path == '/operate/v3/compositions': return [{'id':'comp-1','name':'General'}]
        return None

class WorkplaceInventoryTests(unittest.TestCase):
    def setUp(self):
        self.api=FakeApi()
        self.ctrl=WorkplaceController({}, {'operate':{
            'list_workplaces':'/operate/v3/workplaces',
            'list_sources':'/operate/v3/sources',
            'list_compositions':'/operate/v3/compositions',
            'clear_workplace_content':'/operate/v3/workplaces/{workplaceId}/content',
            'set_workplace_content':'/operate/v3/workplaces/{workplaceId}/content',
            'get_workplace_content':'/operate/v3/workplaces/{workplaceId}/content',
        }}, self.api)
    def test_lists_workplaces(self):
        self.assertEqual(self.ctrl.list_workplaces()[0]['id'],'wp-1')
    def test_sources_are_scoped_to_workplace(self):
        self.assertEqual(self.ctrl.list_sources('wp-1')[0]['id'],'src-1')
        self.assertIn(('GET','/operate/v3/sources',{'workplaceId':'wp-1'}), self.api.calls)

if __name__=='__main__': unittest.main()
