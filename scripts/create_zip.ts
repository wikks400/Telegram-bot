import fs from 'node:fs';
import path from 'node:path';
import { ZipArchive } from 'archiver';

export async function generateProjectZip(outputPath: string = './telegram-nft-smart-money-bot.zip'): Promise<string> {
  const resolvedOut = path.resolve(outputPath);
  const output = fs.createWriteStream(resolvedOut);
  const archive = new ZipArchive({ zlib: { level: 9 } });

  return new Promise((resolve, reject) => {
    output.on('close', () => {
      console.log(`✅ Project archive created: ${resolvedOut} (${archive.pointer()} total bytes)`);
      resolve(resolvedOut);
    });

    archive.on('error', (err) => {
      reject(err);
    });

    archive.pipe(output);

    // Root configuration & documentation files
    const rootFiles = [
      'package.json',
      'package-lock.json',
      'tsconfig.json',
      'vite.config.ts',
      'index.html',
      'metadata.json',
      '.env.example',
      '.npmrc',
      'README.md',
      'server.ts',
    ];

    for (const f of rootFiles) {
      if (fs.existsSync(f)) {
        archive.file(f, { name: f });
      }
    }

    // Include directories: src, test, scripts, and pre-built dist
    if (fs.existsSync('src')) {
      archive.directory('src/', 'src');
    }
    if (fs.existsSync('dist')) {
      archive.directory('dist/', 'dist');
    }
    if (fs.existsSync('test')) {
      archive.directory('test/', 'test');
    }
    if (fs.existsSync('scripts')) {
      archive.directory('scripts/', 'scripts');
    }

    archive.finalize();
  });
}

if (process.argv[1]?.includes('create_zip')) {
  generateProjectZip().catch((err) => {
    console.error('Failed creating zip:', err);
    process.exit(1);
  });
}
