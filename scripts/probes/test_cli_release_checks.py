import unittest
from cli_release_checks import anchored_comment

class AnchoredCommentTests(unittest.TestCase):
    def test_terminal_period_is_optional_but_anchor_and_message_are_required(self):
        comment = dict(quote='Revenue: 42.', quote_found=True, anchor={'nodeId': 'abcd'},
                       orphaned=False, thread=[{'body': 'Checked'}])
        self.assertTrue(anchored_comment([comment], 'Revenue: 42.', 'Checked.'))
        for change in [dict(quote='Other'), dict(quote_found=False), dict(anchor={}),
                       dict(orphaned=True), dict(thread=[{'body': 'Not Checked'}])]:
            self.assertFalse(anchored_comment([{**comment, **change}], 'Revenue: 42.', 'Checked.'))

if __name__ == '__main__':
    unittest.main()
