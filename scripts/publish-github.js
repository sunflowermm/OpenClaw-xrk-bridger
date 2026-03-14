const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const root = process.cwd();
const npmrc = path.join(root, '.npmrc');
const npmrcGh = path.join(root, '.npmrc.github');

const orig = fs.readFileSync(npmrc, 'utf8');
const ghContent = fs.readFileSync(npmrcGh, 'utf8');

try {
  fs.writeFileSync(npmrc, ghContent);
  execSync('npm publish', { stdio: 'inherit', cwd: root });
} finally {
  fs.writeFileSync(npmrc, orig);
}
