"""Legacy provider-neutral interface retained for existing import compatibility.

Live order notifications use order_notifications (transactional intent) and
order_notification_worker/transport (saved providers), not this unconfigured
legacy interface. No password-recovery or invitation transport uses that worker.
"""
from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass(frozen=True)
class Notification:
    template_code: str
    channel: str
    recipient: str
    language: str
    variables: dict[str, str]


class NotificationService(ABC):
    @abstractmethod
    def send(self, notification: Notification) -> str: ...


class UnconfiguredNotificationService(NotificationService):
    def send(self, notification: Notification) -> str:
        raise RuntimeError("A notification provider and template resolver must be configured first")