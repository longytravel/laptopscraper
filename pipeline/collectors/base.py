from __future__ import annotations

from abc import ABC, abstractmethod

from pipeline.models import Listing, SoldComp


class ActiveListingCollector(ABC):
    @abstractmethod
    async def collect_active(self, search_term: str, limit: int) -> list[Listing]:
        raise NotImplementedError


class SoldCompCollector(ABC):
    @abstractmethod
    async def collect_sold_comps(self, search_term: str, lookback_days: int) -> list[SoldComp]:
        raise NotImplementedError
