"""GET /api/checklist-registry — serves the structured checklist registry
(backend/checklist_registry.py) so the frontend never hardcodes the item list.

Static across the process lifetime (the registry is a module-level constant),
so the frontend caches it with a 1h staleTime and fetches it once per session.
"""

from fastapi import APIRouter

import checklist_registry

router = APIRouter()


@router.get("/api/checklist-registry")
async def get_checklist_registry() -> dict:
    return checklist_registry.get_registry()
