"""
Structured registry — single source of truth for the full apartment-evaluation
checklist Daniel actually uses when buying in Tallinn.

Wave A of the checklist-expansion series (Wave B = finance calculator,
Wave C = score breakdown table — both out of scope here).

Replaces the old 13-key `AI_FILLABLE_CHECKLIST_KEYS` allow-list
(backend/ai_evaluator.py) with a ~96-item registry spanning 4 sections:

  - evaluation     ("Оценка по критериям")  — criteria Daniel scores every listing on
  - ask_seller     ("Вопросы продавцу")      — questions to put to the seller/agent
  - request_docs   ("Документы к запросу")   — documents to request + e-kinnistusraamat checks
  - onsite         ("На месте")              — a 5-part physical inspection walkthrough

Every item has a stable `key` (never renamed once shipped — user_marks are keyed
by it), a `section`, a `group` (sub-category within the section), a Russian
label (`label_ru` — Daniel's language, always non-empty), an optional Estonian
real-estate term (`label_et`), an `ai_fillable` flag (can Claude extract this from
listing text?), an optional `hint`, and an auto-inferred `order` (list position).

Legacy migration: the pre-Wave-A registry only had 13 AI-fillable keys
(s09_01/02, s14_01..10, s16_01..04). `LEGACY_KEY_MAP` maps every old key to its
new-registry home so `data_store.set_checklist_user_mark` can lazily fold
existing `checklist.user_marks` data forward without a bulk migration script.
Two old keys (`s09_02`, `s14_03`) both land on `sec2_building` — both described
overlapping facts (facade/windows year vs. year+material+energy class) and the
new registry merges them into one criterion; this is a deliberate collapse, not
an oversight — see the LEGACY_KEY_MAP comment below.
"""

from dataclasses import dataclass, field
from typing import Optional


@dataclass(frozen=True)
class ChecklistItemDef:
    key: str
    section: str
    group: str
    label_ru: str
    ai_fillable: bool = False
    label_et: Optional[str] = None
    hint: Optional[str] = None
    order: int = 0


# ---------------------------------------------------------------------------
# Section metadata
# ---------------------------------------------------------------------------

SECTION_LABELS: dict[str, str] = {
    "evaluation": "Оценка по критериям",
    "ask_seller": "Вопросы продавцу",
    "request_docs": "Документы к запросу",
    "onsite": "На месте",
}

SECTION_ORDER: list[str] = ["evaluation", "ask_seller", "request_docs", "onsite"]

# Only 'onsite' is displayed with visible sub-group headers in the frontend
# (5 physical-inspection sub-groups); other sections render as a flat,
# order-sorted list within the section. Group labels are still provided for
# every section below so future UI work does not need another registry change.
GROUP_LABELS: dict[str, str] = {
    # evaluation
    "location": "Расположение",
    "price": "Цена",
    "exterior": "Дом и внешний вид",
    "systems": "Отопление и системы",
    "extras": "Дополнения",
    "legal": "Юридическое",
    "market": "Рынок",
    "ku": "КЮ и ремонтный фонд",
    "condition": "Состояние",
    # ask_seller
    "motivation": "Мотивация продажи",
    "neighbors": "Соседи и шум",
    "handover": "Передача квартиры",
    # request_docs
    "docs_request": "Документы для запроса у продавца",
    "kinnistusraamat": "Проверить в e-kinnistusraamat",
    # onsite
    "first_impression": "Первое впечатление и запахи",
    "structure": "Стены / потолок / углы / окна",
    "onsite_systems": "Санузел, кухня, системы",
    "common_areas": "Общие зоны дома",
    "neighborhood": "Район / окрестности",
}

# Sections whose sub-groups should render as visible collapsible headers in
# the UI (smaller/italic, no counter). All other sections render a flat item
# list ordered by `order` — matches the source checklist's own structure.
SUBGROUPED_SECTIONS: frozenset = frozenset({"onsite"})


# ---------------------------------------------------------------------------
# Raw item data: (key, section, group, label_ru, ai_fillable, hint)
# Order in this list is preserved as ChecklistItemDef.order.
# ---------------------------------------------------------------------------

_RAW_ITEMS: list[tuple[str, str, str, str, bool, Optional[str]]] = [
    # ── SECTION 2 — Оценка по критериям (13 items) ──────────────────────────
    ("sec2_address", "evaluation", "location",
     "Адрес — насколько удобное расположение (универ, работа, друзья, центр)",
     True, "AI извлекает district + сравнивает с известными ориентирами"),
    ("sec2_price", "evaluation", "price",
     "Цена и цена за м²", True, "Из данных объявления"),
    ("sec2_building", "evaluation", "exterior",
     "Дом — фасад, год постройки, внешний вид, энергокласс", True,
     "Год постройки, материал, состояние фасада/окон, энергокласс если указан"),
    ("sec2_heating", "evaluation", "systems",
     "Тип отопления (центральное / газ / электричество / индивидуальное)", True, None),
    ("sec2_additions", "evaluation", "extras",
     "Дополнения — балкон, кладовка (panipaik), парковочное место, гараж", True, None),
    ("sec2_renovations_legal", "evaluation", "legal",
     "Перестройки — законные или незаконные, есть ли проект", False, None),
    ("sec2_market_duration", "evaluation", "market",
     "Сколько объект на продаже, снижали ли цену и почему", False, None),
    ("sec2_demand", "evaluation", "market",
     "Спрос на квартиру — есть ли очередь", False, None),
    ("sec2_noise", "evaluation", "location",
     "Шум с улицы", True, "Только если объявление явно упоминает шум/тихую улицу"),
    ("sec2_ku_activity", "evaluation", "ku",
     "КЮ (товарищество) — насколько активное", False, None),
    ("sec2_reno_fund", "evaluation", "ku",
     "Ремонтный фонд — на сколько лет, сколько на квартиру", False, None),
    ("sec2_appraisal", "evaluation", "legal",
     "Маклер — hindamisakt (кто делает: банк выбирает vs риэлтор продавца)", False, None),
    ("sec2_insects", "evaluation", "condition",
     "Проблемы с насекомыми", False, None),

    # ── SECTION 3 — Вопросы продавцу (16 items) ─────────────────────────────
    ("sec3_reason_for_sale", "ask_seller", "motivation",
     "Почему продают квартиру?", False, None),
    ("sec3_owner_occupied", "ask_seller", "motivation",
     "Жил ли продавец сам или квартира сдавалась?", False, None),
    ("sec3_current_tenants", "ask_seller", "motivation",
     "Есть ли сейчас арендаторы?", False, None),
    ("sec3_availability_date", "ask_seller", "motivation",
     "Когда квартира будет свободна?", False, None),
    ("sec3_roof_condition", "ask_seller", "condition",
     "Как давно меняли крышу, не течёт ли (если 9 этаж / верхний)", False, None),
    ("sec3_neighbor_issues", "ask_seller", "neighbors",
     "Были ли проблемы с соседями?", False, None),
    ("sec3_noise_sources", "ask_seller", "neighbors",
     "Есть ли шум сверху, снизу, сбоку, с улицы?", False, None),
    ("sec3_water_damage", "ask_seller", "condition",
     "Были ли протечки, затопления, плесень?", False, None),
    ("sec3_ventilation_issues", "ask_seller", "condition",
     "Есть ли проблемы с вентиляцией?", False, None),
    ("sec3_systems_issues", "ask_seller", "condition",
     "Есть ли проблемы с электричеством, сантехникой, отоплением?", False, None),
    ("sec3_renovation_history", "ask_seller", "condition",
     "Что ремонтировалось и когда? Когда последний раз меняли сантех/электрику?",
     True, "Только если объявление явно указывает год замены сантехники/электрики"),
    ("sec3_layout_changes", "ask_seller", "legal",
     "Делались ли перепланировки? Согласованы ли? По проекту ли?", False, None),
    ("sec3_included_items", "ask_seller", "handover",
     "Какие вещи остаются в квартире? Что продавец забирает?", False, None),
    ("sec3_utility_debts", "ask_seller", "legal",
     "Есть ли долги по коммуналке?", False, None),
    ("sec3_disputes_ownership", "ask_seller", "legal",
     "Есть ли судебные споры, наследственные вопросы, развод, совладельцы?", False, None),
    ("sec3_known_defects", "ask_seller", "legal",
     "Есть ли известные недостатки, о которых продавец обязан сообщить?", False,
     "Юридически критично в Эстонии — зафиксировать до сделки"),

    # ── SECTION 4 — Документы к запросу (20 items) ──────────────────────────
    # -- docs to request from seller (11) --
    ("sec4_extract_kinnistusraamat", "request_docs", "docs_request",
     "Свежий kinnistusraamatu väljavõte", False, None),
    ("sec4_floor_plan", "request_docs", "docs_request",
     "План квартиры", False, None),
    ("sec4_ku_debt_info", "request_docs", "docs_request",
     "Информация о долгах квартиры перед KÜ", False, None),
    ("sec4_ku_minutes", "request_docs", "docs_request",
     "Протоколы последних собраний KÜ", False, None),
    ("sec4_reno_fund_info", "request_docs", "docs_request",
     "Информация о remondifond", False, None),
    ("sec4_ku_loans", "request_docs", "docs_request",
     "Информация о кредитах KÜ", False, None),
    ("sec4_renovation_docs", "request_docs", "docs_request",
     "Если был ремонт — документы, чеки, гарантии", False, None),
    ("sec4_electrical_plumbing_docs", "request_docs", "docs_request",
     "Если меняли электрику/сантехнику — кто делал, есть ли документы", False, None),
    ("sec4_layout_permits", "request_docs", "docs_request",
     "Если была перепланировка — разрешения/согласования", False, None),
    ("sec4_rental_agreement", "request_docs", "docs_request",
     "Если квартира сдавалась — договор аренды и дата освобождения", False, None),
    ("sec4_furniture_list", "request_docs", "docs_request",
     "Список мебели и техники, которые входят в цену", False, None),
    # -- verify in e-kinnistusraamat (9) --
    ("sec4_kr_owner", "request_docs", "kinnistusraamat",
     "Кто является собственником", False, None),
    ("sec4_kr_seller_matches_owner", "request_docs", "kinnistusraamat",
     "Совпадает ли продавец с собственником", False, None),
    ("sec4_kr_co_owners", "request_docs", "kinnistusraamat",
     "Есть ли совладельцы", False, None),
    ("sec4_kr_spouse_consent", "request_docs", "kinnistusraamat",
     "Нужны ли согласия супруга / совладельцев", False, None),
    ("sec4_kr_encumbrances", "request_docs", "kinnistusraamat",
     "Нет ли ипотеки, арестов, запретов, ограничений", False, None),
    ("sec4_kr_easements", "request_docs", "kinnistusraamat",
     "Есть ли сервитуты или права пользования", False, None),
    ("sec4_kr_area_matches", "request_docs", "kinnistusraamat",
     "Соответствует ли площадь и объект тому что продаётся", False, None),
    ("sec4_kr_full_vs_share", "request_docs", "kinnistusraamat",
     "Не продаётся ли доля вместо полноценной квартиры", False, None),
    ("sec4_kr_third_party_rights", "request_docs", "kinnistusraamat",
     "Есть ли права третьих лиц", False, None),

    # ── SECTION 5 — На месте (47 items across 5 sub-groups) ─────────────────
    # -- 5.1 первое впечатление и запахи (2) --
    ("sec5_1_damp_smell", "onsite", "first_impression",
     "Нет ли запаха сырости / канализации / плесени / старого дыма", False, None),
    ("sec5_1_fresh_paint_patch", "onsite", "first_impression",
     "Нет ли свежей краски только в одном углу (может скрывать плесень)", False, None),
    # -- 5.2 стены / потолок / углы / окна (11) --
    ("sec5_2_corners", "onsite", "structure", "Углы у внешних стен", False, None),
    ("sec5_2_ceiling", "onsite", "structure", "Потолок под крышей / ванной соседей", False, None),
    ("sec5_2_wall_around_windows", "onsite", "structure", "Стены вокруг окон", False, None),
    ("sec5_2_windowsills", "onsite", "structure", "Подоконники", False, None),
    ("sec5_2_floor_under_windows", "onsite", "structure",
     "Пол под окнами и возле балкона", False, None),
    ("sec5_2_windows_open", "onsite", "structure", "Открываются ли окна", False, None),
    ("sec5_2_double_glazing_condensation", "onsite", "structure",
     "Нет ли конденсата между стёклами", False, None),
    ("sec5_2_drafts", "onsite", "structure", "Не дует ли из окон", False, None),
    ("sec5_2_floor_creak", "onsite", "structure", "Не скрипит ли сильно пол", False, None),
    ("sec5_2_floor_slope", "onsite", "structure", "Нет ли наклона пола", False, None),
    ("sec5_2_cracks", "onsite", "structure",
     "Нет ли трещин возле окон, дверей, потолка", False, None),
    # -- 5.3 санузел + кухня + системы (12) --
    ("sec5_3_bathroom", "onsite", "onsite_systems",
     "Санузел: швы, силикон, вентиляция, запах, напор воды", False, None),
    ("sec5_3_kitchen_pipes", "onsite", "onsite_systems",
     "Кухня: трубы, сифон, следы протечек под раковиной", False, None),
    ("sec5_3_electrical_panel", "onsite", "onsite_systems",
     "Электрощиток: старые пробки или нормальные автоматы", False, None),
    ("sec5_3_outlet_count", "onsite", "onsite_systems",
     "Количество розеток", False, None),
    ("sec5_3_radiators_even", "onsite", "onsite_systems",
     "Греются ли батареи равномерно", False, None),
    ("sec5_3_heating_adjustable", "onsite", "onsite_systems",
     "Можно ли регулировать отопление", False, None),
    ("sec5_3_ventilation_test", "onsite", "onsite_systems",
     "Работает ли вентиляция (приложить салфетку к решётке)", False, None),
    ("sec5_3_laundry_space", "onsite", "onsite_systems",
     "Место для стиральной машины / посудомойки", False, None),
    ("sec5_3_storage_space", "onsite", "onsite_systems",
     "Хватает ли мест хранения", False, None),
    ("sec5_3_appliances_work", "onsite", "onsite_systems",
     "Работает ли вся техника (если входит в цену)", False, None),
    ("sec5_3_intercom", "onsite", "onsite_systems",
     "Работает ли домофон", False, None),
    ("sec5_3_smoke_detector", "onsite", "onsite_systems",
     "Есть ли датчик дыма", False, None),
    # -- 5.4 общие зоны дома (15) --
    ("sec5_4_entrance", "onsite", "common_areas", "Подъезд", False, None),
    ("sec5_4_basement_access", "onsite", "common_areas",
     "Подвал — есть ли доступ у тебя", False, None),
    ("sec5_4_attic", "onsite", "common_areas", "Чердак — если доступен", False, None),
    ("sec5_4_facade", "onsite", "common_areas", "Фасад визуально", False, None),
    ("sec5_4_roof", "onsite", "common_areas", "Крыша визуально", False, None),
    ("sec5_4_yard", "onsite", "common_areas", "Двор", False, None),
    ("sec5_4_trash_area", "onsite", "common_areas",
     "Мусорная зона — закрытая или со свободным доступом", False, None),
    ("sec5_4_evening_parking", "onsite", "common_areas", "Парковка вечером", False, None),
    ("sec5_4_elevator", "onsite", "common_areas", "Лифт", False, None),
    ("sec5_4_mailboxes", "onsite", "common_areas", "Почтовые ящики", False, None),
    ("sec5_4_stairs_condition", "onsite", "common_areas",
     "Состояние лестниц", False, None),
    ("sec5_4_basement_pipes", "onsite", "common_areas",
     "Состояние труб в подвале", False, None),
    ("sec5_4_basement_damp_smell", "onsite", "common_areas",
     "Нет ли запаха сырости в подвале", False, None),
    ("sec5_4_graffiti_trash", "onsite", "common_areas",
     "Нет ли граффити, сломанных дверей, мусора", False, None),
    ("sec5_4_building_neglect", "onsite", "common_areas",
     "Не выглядит ли дом запущенным", False, None),
    # -- 5.5 район / окрестности (7) --
    ("sec5_5_transit", "onsite", "neighborhood",
     "Сколько идти до остановки", True, "Только если объявление явно указывает расстояние"),
    ("sec5_5_amenities", "onsite", "neighborhood",
     "Где ближайший магазин", True, "Только если объявление явно упоминает магазины рядом"),
    ("sec5_5_pharmacy_doctor_gym", "onsite", "neighborhood",
     "Где аптека, семейный врач, спортзал", False, None),
    ("sec5_5_traffic_noise", "onsite", "neighborhood",
     "Есть ли шум от дороги, трамвая, поездов, баров", True,
     "Только если объявление явно упоминает шум от дороги/трамвая"),
    ("sec5_5_construction", "onsite", "neighborhood",
     "Есть ли стройки рядом", True, "Только если объявление явно упоминает стройки рядом"),
    ("sec5_5_future_development", "onsite", "neighborhood",
     "Нет ли планов застройки которые закроют вид / солнце", False, None),
    ("sec5_5_sun", "onsite", "neighborhood",
     "Как светит солнце утром / вечером, как расположена спальня", True,
     "Только если объявление явно упоминает ориентацию/солнечную сторону"),
]

CHECKLIST_REGISTRY: list[ChecklistItemDef] = [
    ChecklistItemDef(
        key=key, section=section, group=group, label_ru=label_ru,
        ai_fillable=ai_fillable, hint=hint, order=i,
    )
    for i, (key, section, group, label_ru, ai_fillable, hint) in enumerate(_RAW_ITEMS)
]

_BY_KEY: dict[str, ChecklistItemDef] = {item.key: item for item in CHECKLIST_REGISTRY}


# ---------------------------------------------------------------------------
# Legacy key migration (pre-Wave-A 13-key AI_FILLABLE_CHECKLIST_KEYS)
# ---------------------------------------------------------------------------

LEGACY_KEY_MAP: dict[str, str] = {
    # s09_01: "Plumbing / electrical replacement year" -> closest new criterion
    # is "what was renovated and when" (ask_seller).
    "s09_01": "sec3_renovation_history",
    # s09_02: "Facade insulation / windows year" and s14_03: "Year, material,
    # energy class" both describe the building's condition/vintage — the new
    # registry merges them into one criterion (sec2_building) since they were
    # never meaningfully distinct in practice. Deliberate many-to-one mapping.
    "s09_02": "sec2_building",
    "s14_01": "sec2_address",
    "s14_02": "sec2_price",
    "s14_03": "sec2_building",
    "s14_04": "sec2_heating",
    "s14_05": "sec2_additions",
    "s14_09": "sec2_noise",
    "s14_10": "sec5_5_sun",
    "s16_01": "sec5_5_transit",
    "s16_02": "sec5_5_amenities",
    "s16_03": "sec5_5_traffic_noise",
    "s16_04": "sec5_5_construction",
}

_REVERSE_LEGACY_MAP: dict[str, list[str]] = {}
for _old, _new in LEGACY_KEY_MAP.items():
    _REVERSE_LEGACY_MAP.setdefault(_new, []).append(_old)


def legacy_keys_for(new_key: str) -> list[str]:
    """Return the list of old keys (possibly empty) that migrate onto new_key."""
    return list(_REVERSE_LEGACY_MAP.get(new_key, []))


# ---------------------------------------------------------------------------
# Public helpers
# ---------------------------------------------------------------------------

def get_ai_fillable_keys() -> frozenset:
    """Replaces the old ai_evaluator.AI_FILLABLE_CHECKLIST_KEYS constant."""
    return frozenset(item.key for item in CHECKLIST_REGISTRY if item.ai_fillable)


def get_ai_fillable_items() -> list[ChecklistItemDef]:
    """Ordered list of ai_fillable items — used to build the evaluator prompt."""
    return [item for item in CHECKLIST_REGISTRY if item.ai_fillable]


def get_sections() -> list[str]:
    return list(SECTION_ORDER)


def get_item(key: str) -> Optional[ChecklistItemDef]:
    return _BY_KEY.get(key)


def get_registry() -> dict:
    """Serializable registry for GET /api/checklist-registry.

    Shape:
      {
        "sections": [
          {"id": "evaluation", "label_ru": "...", "groups": [
             {"id": "location", "label_ru": "...", "items": [{...}, ...]},
             ...
          ]},
          ...
        ],
        "legacy_key_map": {"s14_01": "sec2_address", ...}
      }
    """
    sections_out = []
    for section_id in SECTION_ORDER:
        section_items = sorted(
            (item for item in CHECKLIST_REGISTRY if item.section == section_id),
            key=lambda i: i.order,
        )
        groups: dict[str, list[ChecklistItemDef]] = {}
        group_order: list[str] = []
        for item in section_items:
            if item.group not in groups:
                groups[item.group] = []
                group_order.append(item.group)
            groups[item.group].append(item)

        groups_out = [
            {
                "id": group_id,
                "label_ru": GROUP_LABELS.get(group_id, group_id),
                "items": [
                    {
                        "key": i.key,
                        "section": i.section,
                        "group": i.group,
                        "label_ru": i.label_ru,
                        "label_et": i.label_et,
                        "ai_fillable": i.ai_fillable,
                        "hint": i.hint,
                        "order": i.order,
                    }
                    for i in groups[group_id]
                ],
            }
            for group_id in group_order
        ]

        sections_out.append({
            "id": section_id,
            "label_ru": SECTION_LABELS[section_id],
            "subgrouped": section_id in SUBGROUPED_SECTIONS,
            "groups": groups_out,
        })

    return {
        "sections": sections_out,
        "legacy_key_map": dict(LEGACY_KEY_MAP),
    }
