/** Safe job error codes; never persist an underlying SQL/error message. */
export class NotificationExecutionError extends Error {
 constructor(readonly code:string,readonly retryable=false){super(code);this.name='NotificationExecutionError';}
}
