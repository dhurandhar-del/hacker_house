"""Who is acting.

Authorization is real; authentication is demo-grade and says so. The role
arrives in a header because the alternative — a login screen — would add a
session store and an hour of work to demonstrate exactly the same boundary.
What is *not* demo-grade is what the role can do: the route is recomputed from
the policy engine on every read and every execute, so a client cannot widen its
own permissions by sending a different one.
"""

from __future__ import annotations

from dataclasses import dataclass

from sentinel.domain.enums import APPROVERS, Role, Route

#: The header the console sets. Named so it cannot be confused with a real one.
ROLE_HEADER = "X-Sentinel-Role"

#: The header that makes a mutating call safe to retry.
IDEMPOTENCY_HEADER = "Idempotency-Key"


@dataclass(frozen=True, slots=True)
class Principal:
    """The actor behind one request."""

    role: Role
    #: Demo-grade identity: the role name unless the client sent something.
    actor_id: str = ""

    @property
    def id(self) -> str:
        return self.actor_id or self.role.value

    def may_approve(self, route: Route) -> bool:
        """Whether this role is on the approver list for that route."""
        return self.role in APPROVERS[route]

    def as_dict(self) -> dict[str, str]:
        return {"actor_id": self.id, "actor_role": self.role.value}


def parse_role(raw: str | None, default: str) -> Role:
    """The role from a header, falling back to the configured default.

    An unrecognised role falls back rather than 400ing: the boundary that
    matters is what `auto` may do, and an unknown role gets the least
    privileged answer either way.
    """
    for candidate in (raw, default):
        if not candidate:
            continue
        try:
            return Role(candidate.strip())
        except ValueError:
            continue
    return Role.ANALYST
