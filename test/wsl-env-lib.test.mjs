import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
    isWslWorkspace,
    distroOf,
    uncToLinux,
    cleanOsName,
    parseProbe,
    probeScript,
    isHealthy,
} from '../lib/wsl-env-lib.js';

test('isWslWorkspace: modern + legacy UNC forms, not Windows/Linux paths', () => {
    assert.equal(isWslWorkspace('\\\\wsl.localhost\\Ubuntu-22.04\\home\\crack\\work'), true);
    assert.equal(isWslWorkspace('\\\\wsl$\\Ubuntu-22.04\\home\\crack\\work'), true);
    assert.equal(isWslWorkspace('E:\\Desktop\\work'), false);
    assert.equal(isWslWorkspace('/home/crack/work'), false); // Linux-side path never starts with \\wsl
    assert.equal(isWslWorkspace('\\\\server\\share\\x'), false); // plain SMB share is not wsl
});

test('distroOf: extracts the distro segment from both UNC forms', () => {
    assert.equal(distroOf('\\\\wsl.localhost\\Ubuntu-22.04\\home\\crack\\work'), 'Ubuntu-22.04');
    assert.equal(distroOf('\\\\wsl$\\Ubuntu\\home\\crack'), 'Ubuntu');
    assert.equal(distroOf('E:\\Desktop\\work'), '');
});

test('uncToLinux: maps a WSL UNC path to a plain Linux path', () => {
    assert.equal(
        uncToLinux('\\\\wsl.localhost\\Ubuntu-22.04\\home\\crack\\.local\\bin\\uv'),
        '/home/crack/.local/bin/uv',
    );
    assert.equal(uncToLinux('E:\\Desktop\\work'), 'E:\\Desktop\\work'); // non-WSL left as-is
});

test('cleanOsName: strips PRETTY_NAME prefix and surrounding quotes', () => {
    assert.equal(cleanOsName('PRETTY_NAME="Ubuntu 22.04.5 LTS"'), 'Ubuntu 22.04.5 LTS');
    assert.equal(cleanOsName('PRETTY_NAME=Ubuntu'), 'Ubuntu');
    assert.equal(cleanOsName('Ubuntu 22.04'), 'Ubuntu 22.04'); // no marker
    assert.equal(cleanOsName('PRETTY_NAME=""'), undefined);
});

test('parseProbe: full marker-line output (regression for the real WSL capture)', () => {
    const out = [
        '__UVX__', '',
        '__UV__', '/home/linuxbrew/.linuxbrew/bin/uv',
        '__UVL__', '',
        '__UVC__', '',
        '__PY__', '/usr/bin/python3',
        '__SH__', '/bin/bash',
        '__OS__', 'PRETTY_NAME="Ubuntu 22.04.5 LTS"',
        '__KERNEL__', '6.18.33.2-microsoft-standard-WSL2',
        '',
    ].join('\n');
    const probe = parseProbe('Ubuntu-22.04', out);
    assert.equal(probe.shell, 'bash'); // full path basename
    assert.equal(probe.uv, '/home/linuxbrew/.linuxbrew/bin/uv');
    assert.equal(probe.uvx, undefined); // empty candidate stays unset
    assert.equal(probe.python, '/usr/bin/python3');
    assert.equal(probe.osName, 'Ubuntu 22.04.5 LTS');
    assert.equal(probe.kernel, '6.18.33.2-microsoft-standard-WSL2');
});

test('parseProbe: uvx fallback when uv is empty', () => {
    const out = [
        '__UVX__', '/home/linuxbrew/.linuxbrew/bin/uvx',
        '__UV__', '',
        '__PY__', '',
        '__SH__', 'bash',
        '__OS__', '',
        '__KERNEL__', '',
        '',
    ].join('\n');
    const probe = parseProbe('Ubuntu', out);
    assert.equal(probe.uv, undefined);
    assert.equal(probe.uvx, '/home/linuxbrew/.linuxbrew/bin/uvx');
});

test('isHealthy: a bare {distro, shell} carries no signal', () => {
    assert.equal(isHealthy({ distro: 'Ubuntu', shell: 'bash' }), false);
    assert.equal(isHealthy({ distro: 'Ubuntu', shell: 'bash', osName: 'Ubuntu' }), true);
    assert.equal(isHealthy({ distro: 'Ubuntu', shell: 'bash', uv: '/x/uv' }), true);
    assert.equal(isHealthy(undefined), false);
});

test('probeScript: stays a single line (must survive the Windows→WSL argv edge)', () => {
    const script = probeScript();
    assert.ok(script.length > 0);
    assert.ok(!script.includes('\n'), 'script must not contain a literal newline');
    assert.ok(script.includes('__UV__'));
    assert.ok(script.includes('/home/linuxbrew/.linuxbrew/bin/uv'));
});