from pydantic import BaseModel, ConfigDict
from pydantic.alias_generators import to_camel


class CamelModel(BaseModel):
    """Base model that (de)serializes JSON as camelCase while keeping
    snake_case attribute names in Python."""

    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True)
