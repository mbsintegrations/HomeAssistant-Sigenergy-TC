"""Errors with intentionally credential-free messages."""


class SigenError(Exception):
    """Base integration error."""


class CloudLoginFailure(SigenError):
    """Allowlisted cloud setup outcome without provider text or account data."""

    def __init__(self, reason: str):
        if reason not in {"invalid_auth", "cannot_connect", "no_cloud_plant", "cloud_login_failed"}:
            raise ValueError("Unsupported cloud login failure reason")
        self.reason = reason
        super().__init__(reason)


class TransportError(SigenError):
    """A transport failed; a write may have reached the device."""


class AuthenticationError(SigenError):
    """Reauthentication is required."""


class CapabilityError(SigenError):
    """Requested feature is not available or approved."""


class SafetyError(SigenError):
    """Command rejected before dispatch."""


class ConfirmationError(SigenError):
    """A dispatched setting could not be confirmed by fresh readback."""
