import {createSql} from '@artifactbin/proof-sql/local';
import {serveSql} from '@artifactbin/proof-sql';
import {checkSql} from './conformance.mjs';
const local = createSql({maxRows: 3, timeoutMs: 2000});
const checks = await checkSql(local);
const server = serveSql(local, {serviceSecret: 'probe-only-not-a-user-token'});
const {url} = server.listen(0);
process.send({url, checks});
process.on('SIGTERM', async () => { await server.close(); process.exit(0); });
