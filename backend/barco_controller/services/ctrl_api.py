from __future__ import annotations

from typing import Any

import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from .oidc import OIDCSession


class CtrlApiError(RuntimeError):
    pass


class CtrlApiClient:
    def __init__(self, base_url: str, api_base: str, oidc: OIDCSession, verify_tls: bool, timeout: int = 30):
        self.base_url = base_url.rstrip("/")
        self.api_base = api_base.rstrip("/")
        self.oidc = oidc
        self.verify_tls = verify_tls
        self.timeout = timeout
        self._http = requests.Session()
        retry = Retry(total=2, connect=2, read=1, backoff_factor=0.25, status_forcelist=(502, 503, 504), allowed_methods=("GET", "DELETE"))
        self._http.mount("https://", HTTPAdapter(max_retries=retry))
        self._http.mount("http://", HTTPAdapter(max_retries=retry))

    def _url(self, path: str) -> str:
        path = path if path.startswith("/") else f"/{path}"
        return f"{self.base_url}{self.api_base}{path}"

    def request(self, method: str, path: str, *, params: dict[str, Any] | None = None, json_body: Any = None) -> Any:
        self.oidc.ensure_access()
        url = self._url(path)
        headers = {"Authorization": f"Bearer {self.oidc.get_access_token()}", "Accept": "application/json"}
        response = self._http.request(
            method.upper(), url, headers=headers, params=params, json=json_body,
            verify=self.verify_tls, timeout=self.timeout,
        )
        if response.status_code >= 400:
            detail = response.text.replace("\r", " ").replace("\n", " ")[:300]
            raise CtrlApiError(f"CTRL respondió {response.status_code} en {method.upper()} {path}: {detail}")
        if not response.content:
            return None
        return response.json() if "json" in response.headers.get("content-type", "").lower() else response.text
