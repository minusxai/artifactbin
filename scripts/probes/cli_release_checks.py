"""Outcome checks for the paid release probe; independent of model wording quirks."""
def anchored_comment(comments, quote, body):
    return any(
        comment.get('quote') == quote
        and comment.get('quote_found') is True
        and bool(comment.get('anchor', {}).get('nodeId'))
        and not comment.get('orphaned')
        and any(reply.get('body', '').strip().rstrip('.') == body.strip().rstrip('.')
                for reply in comment.get('thread', []))
        for comment in comments
    )
