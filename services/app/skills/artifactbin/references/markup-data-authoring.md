---
name: markup-data-authoring
description: Chart authoring.
---
## Read first

## Build chart attributes without counting braces

Construct the viz object as JSON, then serialize it inside ONE JSX expression.
For example, in task-local Python (no SDK):

```python
import json
viz = {"kind": "vega-lite", "spec": {"mark": "bar", "encoding": {
    "x": {"field": "region", "type": "nominal"},
    "y": {"field": "revenue", "type": "quantitative"}}}}
chart = '<Question data="$sales" viz={' + json.dumps(viz) + '} />'
```

Use the generated element in the document. JavaScript's `JSON.stringify` works
the same way. After a brace error, regenerate the attribute from the object;
do not repeatedly patch a guessed run of closing braces. A failed publish did
not change stored markup. Read it again before an exact-text edit.

## Preserve what the statistic means

Check the input row's grain before aggregating. Averages or medians of group
medians are not the average or median of the underlying observations. Preserve
the supplied groups, or explicitly label the derived statistic (for example,
"average of monthly medians"). If a function is unavailable, changing the
function also requires rechecking the interpretation and labels. Never silently
substitute `avg` for `median`.

