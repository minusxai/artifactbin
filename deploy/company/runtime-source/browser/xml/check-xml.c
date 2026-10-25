#include <assert.h>
#include <stdio.h>
#include <string.h>
#include <libxml/parser.h>
#include <libxml/catalog.h>
#include <libxml/xmlregexp.h>
#include <libxml/xinclude.h>
#include <libxml/uri.h>
int main(void) {
  xmlInitParser();
  const char *patterns[] = {"[", "\\", "\\p", "\\p{", "[a-", "(a", "a{", "a{1,", "[\\p{", "[a-z]+"};
  for (unsigned i=0; i<sizeof(patterns)/sizeof(patterns[0]); ++i) {
    xmlRegexpPtr re = xmlRegexpCompile((const xmlChar *)patterns[i]);
    if (re) xmlRegFreeRegexp(re);
  }
  const char *catalog = "<catalog xmlns='urn:oasis:names:tc:entity:xmlns:xml:catalog'><nextCatalog catalog='missing.xml'/><nextCatalog/></catalog>";
  FILE *file=fopen("catalog-fixture.xml", "wb"); assert(file);
  assert(fwrite(catalog,1,strlen(catalog),file)==strlen(catalog)); assert(fclose(file)==0);
  xmlCatalogPtr c=xmlLoadACatalog("catalog-fixture.xml"); assert(c);
  xmlChar *resolved=xmlACatalogResolveSystem(c,(const xmlChar *)"missing:resource");
  xmlFree(resolved); xmlFreeCatalog(c); remove("catalog-fixture.xml");
  const char *doc="<doc xmlns:xi='http://www.w3.org/2001/XInclude'><xi:include href='http://example.invalid/missing' parse='text'><xi:fallback>blocked</xi:fallback></xi:include></doc>";
  xmlDocPtr parsed=xmlReadMemory(doc,(int)strlen(doc),"fixture.xml",NULL,XML_PARSE_NONET); assert(parsed);
  assert(xmlXIncludeProcess(parsed)>=0);
  xmlChar *content=xmlNodeGetContent(xmlDocGetRootElement(parsed));assert(content && strcmp((const char *)content,"blocked")==0);
  xmlFree(content);xmlFreeDoc(parsed);
  xmlChar *escaped=xmlURIEscapeStr((const xmlChar *)"a b",NULL);assert(escaped && strcmp((const char *)escaped,"a%20b")==0);xmlFree(escaped);
  xmlCleanupParser(); puts("XML public API regressions passed"); return 0;
}
