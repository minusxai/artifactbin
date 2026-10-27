"""Private-host command orchestration contracts; acceptance stays in existing tools."""
from typing import Literal, TypedDict, NotRequired

class FileRef(TypedDict):
    path: str
    sha256: str

class Assertion(TypedDict):
    path: str
    equals: object

class Output(TypedDict):
    path: str
    assertions: NotRequired[list[Assertion]]

class Step(TypedDict):
    id: str
    kind: Literal['read', 'browser', 'write', 'review']
    command: NotRequired[list[str]]
    cwd: NotRequired[str]
    inputs: list[FileRef]
    outputs: list[Output]
    approval: NotRequired[FileRef]
    retryExitCodes: NotRequired[list[int]]
    maxAttempts: NotRequired[int]

class Job(TypedDict):
    format: Literal['migration-batch-job-v1']
    id: str
    owner: str
    artifact: str
    version: int
    scope: Literal['latest']
    reviewer: str
    plan: FileRef
    steps: list[Step]

class Grant(TypedDict):
    """Explicit coordinator reservation; expires only before acquisition, never steals a live lock."""
    format: Literal['migration-batch-grant-v1']
    id: str
    coordinator: str
    owner: str
    jobSha256: str
    step: str
    resource: Literal['browser-1', 'browser-2', 'writer']
    expiresAt: float

class Review(TypedDict):
    format: Literal['migration-batch-review-v1']
    accepted: Literal[True]
    reviewer: str
    jobSha256: str
    step: str
    packetSha256: str

class CompletionRequest(TypedDict):
    source: str
    version: int
    queue: str
    prior: FileRef
    nextCount: int
    active: str
