"""按发布白名单生成安装包，不包含本地数据和开发依赖。"""

import argparse
import hashlib
import json
from pathlib import Path
import re
import zipfile

ROOT = Path(__file__).resolve().parent.parent


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output-dir', type=Path, default=ROOT / 'dist')
    args = parser.parse_args()
    manifest = json.loads((ROOT / 'extension/manifest.json').read_text())
    package = json.loads((ROOT / 'package.json').read_text())
    version = manifest['version']
    if not re.fullmatch(r'\d+(?:\.\d+){1,3}', version) or version != package['version']:
        raise SystemExit('扩展与 package.json 版本不一致或格式无效。')
    panel = ROOT / 'extension/panel.html'
    if not panel.exists():
        raise SystemExit('请先运行 npm run build。')
    runtime = {'manifest.json', 'background.js', 'core.js', 'auto.js', 'history.js',
               'capture.js', 'content.js', 'overlay.js', 'friendship.js', 'panel.html'}
    runtime.update(manifest['icons'].values())
    runtime.update(re.findall(r'(?:src|href)="\./([^"?#]+)"', panel.read_text()))
    files = {f'extension/{name}' for name in runtime}
    files.update({'LICENSE', 'README.md', 'docs/USAGE.md', 'docs/PRIVACY.md', 'docs/DEVELOPMENT.md',
                  'assets/brand/verifiedx.svg', 'assets/brand/verifiedx.png'})
    # 文件必须位于仓库内，且不能通过符号链接混入其他本地内容。
    for name in files:
        source = ROOT / name
        if source.is_symlink() or not source.is_file() or ROOT not in source.resolve().parents:
            raise SystemExit(f'发布文件不存在或路径异常：{name}')
    args.output_dir.mkdir(parents=True, exist_ok=True)
    archive = args.output_dir / f'VerifiedX-{version}.zip'
    checksum = archive.with_suffix('.zip.sha256')
    if archive.exists() or checksum.exists():
        raise SystemExit('同版本发布文件已存在，请使用新版本号或其他输出目录。')
    install = f'''VerifiedX {version}
作者：https://x.com/gegesobig

安装：解压后打开 chrome://extensions，开启开发者模式，加载包内 extension 文件夹。
更新：覆盖原扩展目录并重新加载扩展，随后刷新 X 页面。不要先卸载，以保留本地记录。

使用：选择我的关注或我的粉丝，开始扫描并保持标签页可见。关注自动 API 分页，粉丝自动滚动。
限制：空页或底部停滞可能导致提前完成，不能保证全量采集。详见 README.md 与 docs/USAGE.md。
'''
    with zipfile.ZipFile(archive, 'x', compression=zipfile.ZIP_DEFLATED) as bundle:
        for name in sorted(files):
            bundle.write(ROOT / name, name)
        bundle.writestr('安装与更新.txt', install)
    with zipfile.ZipFile(archive) as bundle:
        if bundle.testzip() is not None:
            raise SystemExit('压缩包完整性校验失败。')
        for name in files:
            if bundle.read(name) != (ROOT / name).read_bytes():
                raise SystemExit(f'包内文件与源码不一致：{name}')
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    with checksum.open('x') as output:
        output.write(f'{digest}  {archive.name}\n')
    print(f'已验证 {len(runtime)} 个运行文件：{archive}')
    print(f'SHA-256：{digest}')


if __name__ == '__main__':
    main()
