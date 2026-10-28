# Include after the configured upstream Makefile. Its single compiler invocation
# compiles every test source serially, even under make -j. Keep the exact source
# set and flags, but give each translation unit its own parallel make target.
fixture_sources := $(sort $(abspath $(TESTSRC) $(TOP)/src/tclsqlite.c $(TESTSRC2)))
fixture_objects := $(patsubst /%.c,.testfixture-objects/%.o,$(fixture_sources))
fixture_flags = -DSQLITE_NO_SYNC=1 $(TEMP_STORE) $(TESTFIXTURE_FLAGS)

.PHONY: parallel-testfixture
parallel-testfixture: has_tclsh85 $(fixture_objects) .libs/libsqlite3.a
	$(LTLINK) $(fixture_flags) -o testfixture $(fixture_objects) .libs/libsqlite3.a $(LIBTCL) $(TLIBS)

$(fixture_objects): .testfixture-objects/%.o: /%.c
	@mkdir -p $(dir $@)
	$(TCC) $(LTCOMPILE_EXTRAS) $(fixture_flags) -c $< -o $@
