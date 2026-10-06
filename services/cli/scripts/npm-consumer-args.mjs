/** Native consumers share one tested tarball. Windows also has a separate standard-user standalone npx proof. */
export function npmConsumerArgs(tarball,platform){
 return ['exec','--yes',...(platform==='win32'?[]:['--package',tarball]),'--','afbin','query','rows.csv','--json'];
}

/** Seeded CI installs resolve the locked closure from verified blobs; lifecycle scripts still run. */
export function npmConsumerInstallArgs(tarball,seeded){
 return ['install',...(seeded?['--offline']:[]),'--foreground-scripts','--no-audit','--no-fund',tarball];
}
