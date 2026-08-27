from __future__ import annotations
import tempfile, unittest
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from barco_controller.storage.json_store import JsonStore
from barco_controller.storage.repositories import ExternalSourceRepository, normalize_route_item
from barco_controller.services.external_sources import ExternalRendererService

class ExternalSourceRepositoryTest(unittest.TestCase):
    def test_saves_supported_http_content(self):
        with tempfile.TemporaryDirectory() as td:
            repo=ExternalSourceRepository(JsonStore(Path(td)/'external.json'))
            item=repo.save({'name':'Dashboard','type':'web','url':'https://example.com','rendererId':'main'})
            self.assertEqual(item['type'],'web')
            self.assertEqual(repo.get(item['id'])['url'],'https://example.com')
    def test_rejects_file_scheme(self):
        with tempfile.TemporaryDirectory() as td:
            repo=ExternalSourceRepository(JsonStore(Path(td)/'external.json'))
            with self.assertRaises(ValueError): repo.save({'name':'x','type':'image','url':'file:///c:/secret.png'})
    def test_renderer_uses_api_renderer_route(self):
        with tempfile.TemporaryDirectory() as td:
            repo=ExternalSourceRepository(JsonStore(Path(td)/'external.json'))
            item=repo.save({'name':'Poster','type':'image','url':'https://example.com/a.jpg','rendererId':'main'})
            svc=ExternalRendererService(repo, {'renderers':[]})
            self.assertEqual(svc._target_url(item, 'http://127.0.0.1:8080'), f"http://127.0.0.1:8080/api/renderer/{item['id']}")
    def test_route_accepts_external(self):
        item=normalize_route_item({'kind':'external','id':'abc','label':'Web'})
        self.assertEqual(item['kind'],'external')
        self.assertEqual(item['id'],'abc')
    def test_browser_launch_forces_new_maximized_window(self):
        with tempfile.TemporaryDirectory() as td:
            repo=ExternalSourceRepository(JsonStore(Path(td)/'external.json'))
            svc=ExternalRendererService(repo, {'renderers':[]})
            renderer={'profile_dir':str(Path(td)/'profile'),'launch_mode':'kiosk','extra_args':[]}
            args=svc._args('chrome.exe', renderer, 'https://example.com')
            self.assertIn('--new-window', args)
            self.assertIn('--start-maximized', args)
            self.assertIn('--window-position=0,0', args)
            self.assertIn('--kiosk', args)

if __name__=='__main__': unittest.main()
