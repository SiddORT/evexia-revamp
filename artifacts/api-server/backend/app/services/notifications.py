"""Provider-neutral notification contract. No messaging is sent until configured."""
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