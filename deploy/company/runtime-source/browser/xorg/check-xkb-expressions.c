/* Regression inputs for the exact upstream xkbcomp expression fixes.
 * Include the unchanged upstream implementations so their internal predicate
 * routine is exercised too. Link-time section GC removes unrelated parser code.
 */
#include <assert.h>
#include <stdio.h>
#include <string.h>
#include "expr.c"
#include "compat.c"

unsigned warningLevel = 0;
char *scanFile = "public-expression-fixture";

int main(int argc, char **argv) {
    assert(argc == 2);
    /* Match xkbcomp main: rejected expressions must have a diagnostic stream. */
    assert(uSetErrorFile(NULL));
    XkbInitAtoms(NULL);
    ExprResult result = {0}, element = {0}, field = {0};
    ExprDef *index = NULL;
    Atom valid = XkbInternAtom(NULL, "anyof", False);
    assert(valid != None);
    if (strcmp(argv[1], "boolean-negation") == 0) {
        ExprDef literal = {.op = ExprValue, .type = TypeBoolean, .value.ival = True};
        ExprDef negate = {.op = OpNot, .type = TypeBoolean, .value.child = &literal};
        assert(ExprResolveBoolean(&negate, &result, NULL, NULL));
        assert(result.uval == False);
    } else if (strcmp(argv[1], "invalid-identifier") == 0) {
        ExprDef identifier = {.op = ExprIdent, .value.str = None};
        assert(!ExprResolveLhs(&identifier, &element, &field, &index));
        assert(field.str == NULL);
    } else if (strcmp(argv[1], "invalid-field-atoms") == 0) {
        ExprDef invalid_element = {.op = ExprFieldRef, .value.field = {.element = None, .field = valid}};
        ExprDef invalid_field = {.op = ExprFieldRef, .value.field = {.element = valid, .field = None}};
        ExprDef invalid_array = {.op = ExprArrayRef, .value.array = {.element = valid, .field = None, .entry = NULL}};
        assert(!ExprResolveLhs(&invalid_element, &element, &field, &index));
        assert(!ExprResolveLhs(&invalid_field, &element, &field, &index));
        assert(!ExprResolveLhs(&invalid_array, &element, &field, &index));
    } else if (strcmp(argv[1], "missing-modmask-arguments") == 0) {
        ExprDef predicate = {.op = ExprActionDecl, .value.action = {.name = valid, .args = NULL}};
        unsigned pred = 0, mods = 0;
        assert(!ResolveStateAndPredicate(&predicate, &pred, &mods, NULL));
    } else {
        assert(!"Unknown fixture");
    }
    printf("xkbcomp expression regression %s PASS\n", argv[1]);
    return 0;
}
