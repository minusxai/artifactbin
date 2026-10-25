/* Ordinary IPP request against a disposable loopback HTTP fixture. */
#include <cups/cups.h>
#include <cups/http.h>
#include <cups/ipp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
int main(int argc,char **argv) {
  if(argc!=2)return 2;
  const char *agent=cupsUserAgent();
  if(!agent||!strstr(agent,"CUPS/2"))return 8;
  char scheme[32],user[64],host[256],resource[256];int port=0;
  if(httpSeparateURI(HTTP_URI_CODING_ALL,"ipp://localhost:631/printers/fixture",scheme,sizeof(scheme),user,sizeof(user),host,sizeof(host),&port,resource,sizeof(resource))!=HTTP_URI_STATUS_OK)return 3;
  if(strcmp(scheme,"ipp")||strcmp(host,"localhost")||port!=631||strcmp(resource,"/printers/fixture"))return 4;
  http_t *http=httpConnect2("127.0.0.1",atoi(argv[1]),NULL,AF_UNSPEC,HTTP_ENCRYPTION_NEVER,1,5000,NULL);
  if(!http)return 5;
  ipp_t *request=ippNewRequest(IPP_OP_GET_PRINTER_ATTRIBUTES);
  ippAddString(request,IPP_TAG_OPERATION,IPP_TAG_URI,"printer-uri",NULL,"ipp://localhost/printers/fixture");
  ippAddString(request,IPP_TAG_OPERATION,IPP_TAG_KEYWORD,"requested-attributes",NULL,"printer-name");
  ipp_t *response=cupsDoRequest(http,request,"/printers/fixture");
  if(!response){httpClose(http);return 6;}
  ipp_attribute_t *attribute=ippFindAttribute(response,"printer-name",IPP_TAG_NAME);
  const char *value=attribute?ippGetString(attribute,0,NULL):NULL;
  int good=ippGetStatusCode(response)==IPP_STATUS_OK&&value&&!strcmp(value,"fixture");
  ippDelete(response);httpClose(http);
  if(!good)return 7;
  puts("PASS normal IPP shared-library request/response and URI parsing");return 0;
}
