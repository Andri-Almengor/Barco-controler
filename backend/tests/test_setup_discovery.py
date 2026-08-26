from __future__ import annotations
import unittest

try:
    from flask import Flask
    from barco_controller.api.setup import create_setup_blueprint
except ModuleNotFoundError:
    Flask = None
    create_setup_blueprint = None

class FakeOidc:
    def ensure_access(self): return None
class FakeWorkplace:
    def list_workplaces(self): return [{'id':'wp-1','name':'Wall principal'}]
    def list_sources(self, workplace_id=None): return [{'id':'src-vnc','name':'Renderer VNC','type':'VNC'}] if workplace_id == 'wp-1' else []
    def list_compositions(self): return [{'id':'comp-1','name':'General'}]
class FakeState:
    configured=True
    config_error=None
    cfg={
        'server':{'host':'127.0.0.1','port':8080},
        'barco':{'base_url':'https://ctrl','api_base':'/api','oidc':{'realm':'OCS','client_id':'proxima','client_secret_env':'CTRL_CLIENT_SECRET'},'tls':{'verify_tls':True}},
        'workplaces':[{'id':'wp-1','name':'Wall principal','geometry':{'type':'px','x':0,'y':0,'width':1920,'height':1080}}],
        'routes':{},'cameras':{},'renderers':[]
    }
    oidc=FakeOidc()
    workplace=FakeWorkplace()

@unittest.skipIf(Flask is None, 'Flask no está instalado en el entorno de prueba actual')
class SetupDiscoveryTests(unittest.TestCase):
    def test_authenticated_operator_can_rediscover_inventory_without_resending_password(self):
        app=Flask(__name__); app.secret_key='test'; state=FakeState(); app.register_blueprint(create_setup_blueprint(state),url_prefix='/api')
        with app.test_client() as client:
            with client.session_transaction() as sess: sess['operator_authenticated']=True
            response=client.post('/api/setup/discover',json={'config':state.cfg,'workplaceId':'wp-1'})
            self.assertEqual(response.status_code,200)
            data=response.get_json(); self.assertTrue(data['ok']); self.assertEqual(data['authMode'],'existing-session'); self.assertEqual(data['sources'][0]['id'],'src-vnc')

if __name__=='__main__': unittest.main()
