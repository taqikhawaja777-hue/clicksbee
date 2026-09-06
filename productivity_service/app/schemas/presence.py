from datetime import date as date_
from datetime import datetime
from typing import Literal
from uuid import UUID

from . import CamelModel

CombinedStatus = Literal['active', 'idle', 'away']


class CameraConsentIn(CamelModel):
    employee_id: UUID
    consented: bool


class CameraConsentOut(CamelModel):
    id: UUID
    employee_id: UUID
    consented: bool
    created_at: datetime


class CameraMonitoringConfigOut(CamelModel):
    employee_id: UUID
    globally_enabled: bool
    employee_enabled: bool
    effective_enabled: bool


class GlobalCameraConfigIn(CamelModel):
    globally_enabled: bool


class EmployeeCameraConfigIn(CamelModel):
    enabled: bool


class PresenceLogIn(CamelModel):
    """One raw client-side check, ~every 15-30s. combined_status is computed
    by the client (it's the only side that has both signals for this exact
    instant) - the server records it, it doesn't re-derive it."""

    employee_id: UUID
    timestamp: datetime
    face_detected: bool
    mouse_keyboard_active: bool
    combined_status: CombinedStatus


class PresenceLogOut(CamelModel):
    id: UUID
    employee_id: UUID
    occurred_at: datetime
    face_detected: bool
    mouse_keyboard_active: bool
    combined_status: CombinedStatus


class PresenceSummaryOut(CamelModel):
    employee_id: UUID
    date: date_
    sample_count: int
    camera_active_seconds: int
    input_active_seconds: int
    combined_active_seconds: int
    idle_away_seconds: int
