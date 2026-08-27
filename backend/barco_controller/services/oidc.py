from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from typing import Any

import requests


class OIDCError(RuntimeError):
    pass


@dataclass
class TokenSet:
    access_token: str
    refresh_token: str | None
    expires_at: float


class OIDCSession:
    def __init__(self, issuer_base: str, client_id: str, client_secret: str | None, verify_tls: bool, timeout: int = 20):
        self.issuer_base = issuer_base.rstrip("/")
        self.client_id = client_id
        self.client_secret = client_secret
        self.verify_tls = verify_tls
        self.timeout = timeout
        self._well_known: dict[str, Any] | None = None
        self._token: TokenSet | None = None
        self._lock = threading.RLock()
        self._http = requests.Session()

    def _get_well_known(self) -> dict[str, Any]:
        with self._lock:
            if self._well_known is None:
                url = f"{self.issuer_base}/.well-known/openid-configuration"
                response = self._http.get(url, verify=self.verify_tls, timeout=self.timeout)
                response.raise_for_status()
                self._well_known = response.json()
            return self._well_known

    @property
    def token_endpoint(self) -> str:
        return str(self._get_well_known()["token_endpoint"])

    def is_access_valid(self, skew_sec: int = 60) -> bool:
        with self._lock:
            return self._token is not None and time.time() < self._token.expires_at - skew_sec

    def get_access_token(self) -> str:
        with self._lock:
            if not self._token:
                raise OIDCError("No hay sesión activa")
            return self._token.access_token

    def _set_tokens(self, payload: dict[str, Any]) -> None:
        access = payload.get("access_token")
        if not access:
            raise OIDCError("El servidor OIDC no devolvió access_token")
        refresh = payload.get("refresh_token") or (self._token.refresh_token if self._token else None)
        expires_in = max(1, int(payload.get("expires_in") or 60))
        self._token = TokenSet(str(access), str(refresh) if refresh else None, time.time() + expires_in)

    def login_password_grant(self, username: str, password: str) -> None:
        data = {"grant_type": "password", "client_id": self.client_id, "username": username, "password": password}
        if self.client_secret:
            data["client_secret"] = self.client_secret
        response = self._http.post(self.token_endpoint, data=data, verify=self.verify_tls, timeout=self.timeout)
        if response.status_code >= 400:
            raise OIDCError(f"Login rechazado por CTRL ({response.status_code})")
        with self._lock:
            self._set_tokens(response.json())

    def refresh(self) -> None:
        with self._lock:
            refresh_token = self._token.refresh_token if self._token else None
        if not refresh_token:
            raise OIDCError("No hay refresh_token; inicia sesión nuevamente")
        data = {"grant_type": "refresh_token", "client_id": self.client_id, "refresh_token": refresh_token}
        if self.client_secret:
            data["client_secret"] = self.client_secret
        response = self._http.post(self.token_endpoint, data=data, verify=self.verify_tls, timeout=self.timeout)
        if response.status_code >= 400:
            with self._lock:
                self._token = None
            raise OIDCError("La sesión de CTRL expiró")
        with self._lock:
            self._set_tokens(response.json())

    def ensure_access(self) -> None:
        if self.is_access_valid():
            return
        self.refresh()

    def adopt_session_from(self, other: "OIDCSession") -> bool:
        """Copy an authenticated session when the OIDC identity did not change.

        Configuration changes such as adding a wall or changing renderer settings
        rebuild the runtime. They must not force an operator to log in again. A
        token is reused only when issuer/client credentials still represent the
        same OIDC client; changing CTRL server, realm or client ID intentionally
        requires a fresh login.
        """
        if not isinstance(other, OIDCSession):
            return False
        if (
            self.issuer_base != other.issuer_base
            or self.client_id != other.client_id
            or self.client_secret != other.client_secret
        ):
            return False

        with other._lock:
            old_token = other._token
            old_well_known = dict(other._well_known) if isinstance(other._well_known, dict) else None

        if old_token is None:
            return False

        copied = TokenSet(
            access_token=old_token.access_token,
            refresh_token=old_token.refresh_token,
            expires_at=old_token.expires_at,
        )
        with self._lock:
            self._token = copied
            self._well_known = old_well_known
        return True

    def logout(self) -> None:
        with self._lock:
            self._token = None

    def status(self) -> dict[str, Any]:
        with self._lock:
            token = self._token
        return {
            "authenticated": bool(token),
            "accessValid": self.is_access_valid() if token else False,
            "expiresAt": token.expires_at if token else None,
        }
