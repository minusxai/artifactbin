/** Native consumers share one tested tarball. Windows also has a separate standard-user standalone npx proof. */
export function npmConsumerArgs(tarball,platform){
 return ['exec','--yes',...(platform==='win32'?[]:['--package',tarball]),'--','afbin','query','rows.csv','--json'];
}
