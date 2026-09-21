"""The repository port: the only door to TigerGraph."""

from __future__ import annotations

from abc import ABC, abstractmethod
from collections.abc import Mapping, Sequence
from typing import Any


class GraphRepository(ABC):
    """The only door to TigerGraph.

    Responsibility: transport, authentication, retry and normalisation. It knows
    nothing about fraud, evidence or policy, and it applies no thresholds — a
    repository that decided anything would put that decision beyond unit test.
    Collaborators: TokenManager and ResponseNormalizer in the REST implementation;
    nothing at all in the fake.

    Six operations cover every TigerGraph call site in the system: the sixteen
    installed queries, the case write-back's vertex and edge upserts, the
    validator's existence checks and the health endpoint's vertex census.
    """

    @abstractmethod
    async def run_query(self, name: str, params: Mapping[str, Any]) -> dict[str, Any]:
        """Run an installed query and return its flattened, sanitised result.

        The returned dict is keyed by the query's ``PRINT ... AS`` names. Attribute
        keys inside printed vertex rows keep their GSQL alias prefix (``T.txn_id``);
        stripping that is the caller's business, through ``ResponseNormalizer``.

        Raises:
            QueryFailed: the query ran and TigerGraph returned an error payload.
            GraphUnavailable: the workspace could not be reached or kept waking.
        """

    @abstractmethod
    async def upsert_vertex(self, vtype: str, vid: str, attrs: Mapping[str, Any]) -> int:
        """Upsert one vertex. Returns the number of vertices TigerGraph accepted."""

    @abstractmethod
    async def upsert_edge(
        self,
        etype: str,
        src_type: str,
        src: str,
        dst_type: str,
        dst: str,
        attrs: Mapping[str, Any] | None = None,
    ) -> int:
        """Upsert one edge. Returns the number of edges TigerGraph accepted."""

    @abstractmethod
    async def get_vertex(self, vtype: str, vid: str) -> dict[str, Any] | None:
        """One vertex as TigerGraph returns it: ``{v_id, v_type, attributes}``.

        Returns ``None`` when the vertex is absent, and raises only when the lookup
        itself failed. Callers decide whether absence is an error; ``eval/validate.py``
        collapsed the two and so reported a transient auth failure as an invalid
        submission.
        """

    @abstractmethod
    async def get_vertices(self, vtype: str, ids: Sequence[str]) -> dict[str, dict[str, Any]]:
        """Several vertices by id, keyed by id. Absent ids are simply missing."""

    @abstractmethod
    async def stat_vertex_counts(self) -> dict[str, int]:
        """Vertex counts per type, for the health endpoint and the load check."""
