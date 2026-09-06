"""A minimal in-memory stand-in for the Supabase Python client's fluent
query builder, used by tests that need real service-layer behavior (joins,
upserts, dedupe) without a live database."""
from uuid import uuid4


class FakeResponse:
    def __init__(self, data, count=None):
        self.data = data
        self.count = count


class FakeQuery:
    def __init__(self, table_name: str, store: dict):
        self.table_name = table_name
        self.store = store
        self._insert_payload = None
        self._upsert_payload = None
        self._upsert_conflict_col = None
        self._update_payload = None
        self._filters: dict = {}
        self._select_count = False
        self._order = None
        self._limit = None

    def select(self, *_args, **kwargs):
        if kwargs.get("count") == "exact":
            self._select_count = True
        return self

    def eq(self, field, value):
        self._filters[field] = ("eq", value)
        return self

    def in_(self, field, values):
        self._filters[field] = ("in", list(values))
        return self

    def gte(self, field, value):
        self._filters[field] = ("gte", value)
        return self

    def lte(self, field, value):
        self._filters[field] = ("lte", value)
        return self

    def order(self, field, desc=False):
        self._order = (field, desc)
        return self

    def limit(self, n):
        self._limit = ("limit", n)
        return self

    def range(self, start, end):
        self._limit = ("range", start, end)
        return self

    def insert(self, payload):
        self._insert_payload = payload
        return self

    def upsert(self, payload, on_conflict=None):
        self._upsert_payload = payload
        self._upsert_conflict_col = on_conflict
        return self

    def update(self, payload):
        self._update_payload = payload
        return self

    def _matches(self, row: dict) -> bool:
        for key, (op, value) in self._filters.items():
            cell = row.get(key)
            if op == "eq" and cell != value:
                return False
            if op == "in" and cell not in value:
                return False
            if op == "gte" and (cell is None or cell < value):
                return False
            if op == "lte" and (cell is None or cell > value):
                return False
        return True

    def execute(self):
        rows = self.store.setdefault(self.table_name, [])

        if self._insert_payload is not None:
            payloads = self._insert_payload if isinstance(self._insert_payload, list) else [self._insert_payload]
            created = []
            for payload in payloads:
                row = {**payload}
                row.setdefault("id", str(uuid4()))
                rows.append(row)
                created.append(row)
            return FakeResponse(created)

        if self._upsert_payload is not None:
            payloads = self._upsert_payload if isinstance(self._upsert_payload, list) else [self._upsert_payload]
            result = []
            for payload in payloads:
                existing = None
                if self._upsert_conflict_col:
                    # on_conflict may be a compound key ("employee_id,date") -
                    # match on every column named, not the literal
                    # comma-joined string as one dict key.
                    conflict_cols = [c.strip() for c in self._upsert_conflict_col.split(",")]
                    existing = next(
                        (
                            r
                            for r in rows
                            if all(r.get(col) == payload.get(col) for col in conflict_cols)
                        ),
                        None,
                    )
                if existing is not None:
                    existing.update(payload)
                    result.append(existing)
                else:
                    row = {**payload}
                    row.setdefault("id", str(uuid4()))
                    rows.append(row)
                    result.append(row)
            return FakeResponse(result)

        if self._update_payload is not None:
            updated = []
            for row in rows:
                if self._matches(row):
                    row.update(self._update_payload)
                    updated.append(row)
            return FakeResponse(updated)

        matched = [row for row in rows if self._matches(row)]
        if self._order:
            field, desc = self._order
            matched = sorted(matched, key=lambda r: r.get(field) or "", reverse=desc)
        if self._limit:
            if self._limit[0] == "limit":
                matched = matched[: self._limit[1]]
            elif self._limit[0] == "range":
                _, start, end = self._limit
                matched = matched[start : end + 1]

        count = len(matched) if self._select_count else None
        return FakeResponse(matched, count=count)


class FakeSupabaseClient:
    def __init__(self, store: dict | None = None):
        self.store = store if store is not None else {}

    def table(self, name: str):
        return FakeQuery(name, self.store)
