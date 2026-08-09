"""Tests for Wave C — description translation + bulleted summary.

Covers:
  - ai_evaluator._validate_description_ru / _validate_description_bullets:
    type coercion, truncation, dropping malformed bullet items.
  - data_store.save_ai_translation: JSONB persistence, GET /api/data reflects it.
  - Fresh listing (no translation yet) -> description_ru/description_bullets are null.
  - Ingest pipeline: mocked evaluate_listing() carries description_ru/bullets onto
    the pending entry (piggybacked on the same AI call, no second round-trip).
  - POST /api/entry/{id}/regenerate-description: 200 {ok: true}, 404 for missing
    listing, and (via a synchronous thread stub) persists the refreshed translation.
"""

import ai_evaluator


# ---------------------------------------------------------------------------
# ai_evaluator._validate_description_ru
# ---------------------------------------------------------------------------

class TestValidateDescriptionRu:
    def test_valid_string_passes_through(self):
        assert ai_evaluator._validate_description_ru("Продаётся квартира") == "Продаётся квартира"

    def test_empty_string_is_valid(self):
        assert ai_evaluator._validate_description_ru("") == ""

    def test_none_becomes_empty_string(self):
        assert ai_evaluator._validate_description_ru(None) == ""

    def test_non_string_becomes_empty_string(self):
        assert ai_evaluator._validate_description_ru(12345) == ""
        assert ai_evaluator._validate_description_ru(["not", "a", "string"]) == ""

    def test_truncates_over_long_string(self):
        long_text = "a" * (ai_evaluator.DESCRIPTION_RU_MAX_CHARS + 500)
        result = ai_evaluator._validate_description_ru(long_text)
        assert len(result) == ai_evaluator.DESCRIPTION_RU_MAX_CHARS


# ---------------------------------------------------------------------------
# ai_evaluator._validate_description_bullets
# ---------------------------------------------------------------------------

class TestValidateDescriptionBullets:
    def test_valid_list_passes_through(self):
        bullets = ["Ремонт 2020 года", "Паркинг включён", "Энергокласс C"]
        assert ai_evaluator._validate_description_bullets(bullets) == bullets

    def test_none_becomes_empty_list(self):
        assert ai_evaluator._validate_description_bullets(None) == []

    def test_non_list_becomes_empty_list(self):
        assert ai_evaluator._validate_description_bullets("not a list") == []
        assert ai_evaluator._validate_description_bullets({"a": 1}) == []

    def test_drops_non_string_items_keeps_valid_ones(self):
        raw = ["Valid bullet one", 123, None, ["nested"], "Valid bullet two", {"x": 1}]
        result = ai_evaluator._validate_description_bullets(raw)
        assert result == ["Valid bullet one", "Valid bullet two"]

    def test_drops_empty_and_whitespace_only_strings(self):
        raw = ["Real bullet", "", "   ", "Another real bullet"]
        result = ai_evaluator._validate_description_bullets(raw)
        assert result == ["Real bullet", "Another real bullet"]

    def test_truncates_over_long_bullet(self):
        long_bullet = "b" * (ai_evaluator.DESCRIPTION_BULLET_MAX_CHARS + 100)
        result = ai_evaluator._validate_description_bullets([long_bullet])
        assert len(result[0]) == ai_evaluator.DESCRIPTION_BULLET_MAX_CHARS

    def test_caps_at_max_items(self):
        raw = [f"Bullet {i}" for i in range(ai_evaluator.DESCRIPTION_BULLETS_MAX_ITEMS + 10)]
        result = ai_evaluator._validate_description_bullets(raw)
        assert len(result) == ai_evaluator.DESCRIPTION_BULLETS_MAX_ITEMS


# ---------------------------------------------------------------------------
# data_store.save_ai_translation
# ---------------------------------------------------------------------------

class TestSaveAiTranslation:
    def test_writes_to_jsonb_and_get_data_reflects_it(self, db_session, client, tmp_agent_state):
        import data_store  # noqa: PLC0415

        data_store.add_to_pending({
            "id": "translate-1",
            "title": "Test Apt",
            "url": "https://www.kv.ee/translate-1.html",
            "status": "pending",
        })
        # Move to approved so it shows up in GET /api/data's properties[] list.
        data_store.approve_listing("translate-1")

        ok = data_store.save_ai_translation(
            "translate-1",
            "Полный перевод описания на русский язык.",
            ["Ремонт 2020 года", "Паркинг включён"],
        )
        assert ok is True

        resp = client.get("/api/data")
        assert resp.status_code == 200
        body = resp.json()
        entry = next((p for p in body["properties"] if p["id"] == "translate-1"), None)
        assert entry is not None
        assert entry["description_ru"] == "Полный перевод описания на русский язык."
        assert entry["description_bullets"] == ["Ремонт 2020 года", "Паркинг включён"]

    def test_returns_false_for_missing_listing(self, db_session, tmp_agent_state):
        import data_store  # noqa: PLC0415

        ok = data_store.save_ai_translation("does-not-exist", "текст", ["bullet"])
        assert ok is False

    def test_fresh_listing_without_translation_returns_null(self, db_session, client, tmp_agent_state):
        import data_store  # noqa: PLC0415

        data_store.add_to_pending({
            "id": "fresh-1",
            "title": "Fresh Apt",
            "url": "https://www.kv.ee/fresh-1.html",
            "status": "pending",
        })

        resp = client.get("/api/data")
        assert resp.status_code == 200
        body = resp.json()
        entry = next((p for p in body["pending"] if p["id"] == "fresh-1"), None)
        assert entry is not None
        assert entry["description_ru"] is None
        assert entry["description_bullets"] is None


# ---------------------------------------------------------------------------
# Ingest pipeline carries description_ru/description_bullets onto pending entry
# ---------------------------------------------------------------------------

def test_ingest_carries_description_translation_onto_pending_entry(
    client, db_session, tmp_agent_state, mock_send_pending_card, monkeypatch,
):
    import data_store  # noqa: PLC0415
    import ingest_handler  # noqa: PLC0415

    monkeypatch.setattr(
        ingest_handler,
        "evaluate_listing",
        lambda listing, context_prefix="", **kwargs: {
            "score": 80,
            "verdict": "Good",
            "strengths": [],
            "concerns": [],
            "draft_subject": "Test",
            "draft_body": "b",
            "checklist_fills": {},
            "description_ru": "Полный перевод объявления.",
            "description_bullets": ["Факт один", "Факт два"],
        },
    )

    listing_payload = [
        {
            "id": "ingest-translate-1",
            "url": "https://www.kv.ee/ingest-translate-1.html",
            "title": "Test Apartment",
            "price_eur": 200000,
            "rooms": 3,
            "area_sqm": 60.0,
            "image_count": 10,
            "raw_ok": True,
            "description": "Müüa korter Tallinnas.",
        }
    ]

    resp = client.post(
        "/api/ingest",
        json=listing_payload,
        headers={"Authorization": "Bearer test-token-abc"},
    )
    assert resp.status_code == 200

    pending = data_store.load_pending()
    entry = next((e for e in pending if e["id"] == "ingest-translate-1"), None)
    assert entry is not None, f"ingest-translate-1 not in pending: {[e['id'] for e in pending]}"
    assert entry["description_ru"] == "Полный перевод объявления."
    assert entry["description_bullets"] == ["Факт один", "Факт два"]


# ---------------------------------------------------------------------------
# POST /api/entry/{id}/regenerate-description
# ---------------------------------------------------------------------------

class TestRegenerateDescriptionEndpoint:
    def test_returns_200_ok_true_and_404_for_missing_listing(
        self, db_session, client, tmp_agent_state, monkeypatch,
    ):
        import data_store  # noqa: PLC0415
        import ingest_handler  # noqa: PLC0415
        import main as main_mod  # noqa: PLC0415

        data_store.add_to_pending({
            "id": "regen-1",
            "title": "Regen Apt",
            "url": "https://www.kv.ee/regen-1.html",
            "status": "pending",
        })

        class _SyncThread:
            """Fake Thread that runs target synchronously on .start() — avoids
            racing the test's assertions against the real daemon thread."""
            def __init__(self, target, args=(), daemon=False):
                self._target = target
                self._args = args

            def start(self):
                self._target(*self._args)

        def _stub_regen(listing_id: str) -> None:
            data_store.save_ai_translation(listing_id, "тест перевод", ["bullet a", "bullet b"])

        monkeypatch.setattr(main_mod, "threading", type("T", (), {"Thread": _SyncThread})())
        monkeypatch.setattr(ingest_handler, "regenerate_description_translation", _stub_regen)

        resp = client.post("/api/entry/regen-1/regenerate-description")
        assert resp.status_code == 200, f"expected 200 got {resp.status_code}: {resp.text}"
        body = resp.json()
        assert body.get("ok") is True

        # Synchronous stub already ran — verify persistence.
        pending = data_store.load_pending()
        entry = next((e for e in pending if e["id"] == "regen-1"), None)
        assert entry is not None
        assert entry["description_ru"] == "тест перевод"
        assert entry["description_bullets"] == ["bullet a", "bullet b"]

        resp2 = client.post("/api/entry/nonexistent/regenerate-description")
        assert resp2.status_code == 404

    def test_regenerate_description_translation_persists_full_ai_response(
        self, db_session, tmp_agent_state, monkeypatch,
    ):
        """Exercises ingest_handler.regenerate_description_translation end-to-end
        with a mocked evaluate_listing() — verifies the DB row is updated with
        both fields from the mocked AI response."""
        import data_store  # noqa: PLC0415
        import ingest_handler  # noqa: PLC0415
        from db import SessionLocal  # noqa: PLC0415
        from models import Listing as ListingRow  # noqa: PLC0415

        data_store.add_to_pending({
            "id": "regen-2",
            "title": "Regen Apt 2",
            "url": "https://www.kv.ee/regen-2.html",
            "status": "pending",
            "description": "Müüa korter, hea seisukorras.",
        })

        monkeypatch.setattr(
            ingest_handler,
            "evaluate_listing",
            lambda listing, context_prefix="", **kwargs: {
                "score": 70,
                "verdict": "OK",
                "description_ru": "Продаётся квартира в хорошем состоянии.",
                "description_bullets": ["Хорошее состояние", "Готово к переезду"],
            },
        )

        ingest_handler.regenerate_description_translation("regen-2")

        with SessionLocal() as db_:
            row = db_.get(ListingRow, "regen-2")
            assert row is not None
            assert row.description_ru == "Продаётся квартира в хорошем состоянии."
            assert row.description_bullets == ["Хорошее состояние", "Готово к переезду"]

    def test_regenerate_description_translation_missing_listing_is_noop(
        self, db_session, tmp_agent_state, monkeypatch,
    ):
        """Never-raise: calling with an unknown listing_id logs and returns quietly."""
        import ingest_handler  # noqa: PLC0415

        # Should not raise even though the listing doesn't exist.
        ingest_handler.regenerate_description_translation("does-not-exist-at-all")
