"""Conversion-only batch contract: no browser, import, or acceptance authority."""
from typing import TypedDict
from contract import FileRef
class ConversionItem(TypedDict):
    artifact: str
    version: int
    inputs: list[FileRef]
    command: list[str]
    cwd: str
    output: str
class ConversionBatch(TypedDict):
    format: str
    owner: str
    plan: FileRef
    reservation: FileRef
    acceptedRoot: FileRef
    adapter: list[FileRef]
    items: list[ConversionItem]
