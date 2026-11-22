// Tiny stack VM (make.fun tiny-stack-vm-01): table-driven interpreter for the 32-bit
// stack ISA. One run answers every instance under the input directory.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// Opcode table, indexed by opcode byte: [immLen, pops, pushes] packed as 5 chars
// per opcode (2 hex digits + imm + pops + pushes); anything absent traps 5.
const T = '0000001101024010301004012050220602307033100211102112021130211402115021160211701118021190211a0211b0111c0211d0211e0212002121021220213020031210322103320034000400114102050010510105200153010';
const IMM = new Uint8Array(256), POP = new Uint8Array(256), PSH = new Uint8Array(256), VAL = new Uint8Array(256);
for (let k = 0; k < T.length; k += 5) {
  const o = parseInt(T.slice(k, k + 2), 16);
  VAL[o] = 1; IMM[o] = +T[k + 2]; POP[o] = +T[k + 3]; PSH[o] = +T[k + 4];
}
const enc = new TextEncoder();

// Runs one program on one input; returns the bytes written and the exit code
// (a trap's code when the program trapped).
function run(p, q) {
  const n = p.length, S = new Int32Array(256);
  let sp = 0;
  const C = new Int32Array(64);
  let cp = 0;
  const M = new Int32Array(256), out = new Uint8Array(65536);
  let ol = 0, ip = 0, pc = 0, st = 0;
  const done = (e) => ({ o: out.slice(0, ol), e });
  for (;;) {
    if (st === 1000000) return done(10);
    if (pc < 0 || pc >= n) return done(9);
    const op = p[pc];
    if (!VAL[op]) return done(5);
    const im = IMM[op];
    if (pc + im >= n) return done(9);
    st++;
    const nx = pc + 1 + im;
    if (sp < POP[op]) return done(2);
    if (sp - POP[op] + PSH[op] > 256) return done(3);
    pc = nx;
    switch (op) {
      case 0x00: return done(0);
      case 0x01: S[sp++] = (p[nx - 1] << 24) >> 24; break;
      case 0x02: S[sp++] = p[nx - 4] | (p[nx - 3] << 8) | (p[nx - 2] << 16) | (p[nx - 1] << 24); break;
      case 0x03: sp--; break;
      case 0x04: S[sp] = S[sp - 1]; sp++; break;
      case 0x05: { const t = S[sp - 1]; S[sp - 1] = S[sp - 2]; S[sp - 2] = t; break; }
      case 0x06: S[sp] = S[sp - 2]; sp++; break;
      case 0x07: { const a = S[sp - 3]; S[sp - 3] = S[sp - 2]; S[sp - 2] = S[sp - 1]; S[sp - 1] = a; break; }
      case 0x17: S[sp - 1] = -S[sp - 1] | 0; break;
      case 0x1b: S[sp - 1] = ~S[sp - 1]; break;
      case 0x10: case 0x11: case 0x12: case 0x13: case 0x14: case 0x15: case 0x16:
      case 0x18: case 0x19: case 0x1a: case 0x1c: case 0x1d: case 0x1e:
      case 0x20: case 0x21: case 0x22: {
        const b = S[sp - 1], a = S[sp - 2];
        let r;
        switch (op) {
          case 0x10: r = (a + b) | 0; break;
          case 0x11: r = (a - b) | 0; break;
          case 0x12: r = Math.imul(a, b); break;
          case 0x13:
            if (b === 0) return done(4);
            r = a === -2147483648 && b === -1 ? a : (a / b) | 0; break;
          case 0x14:
            if (b === 0) return done(4);
            r = b === -1 ? 0 : (a % b) | 0; break;
          case 0x15:
            if (b === 0) return done(4);
            r = Math.floor((a >>> 0) / (b >>> 0)) | 0; break;
          case 0x16:
            if (b === 0) return done(4);
            r = ((a >>> 0) % (b >>> 0)) | 0; break;
          case 0x18: r = a & b; break;
          case 0x19: r = a | b; break;
          case 0x1a: r = a ^ b; break;
          case 0x1c: r = a << (b & 31); break;
          case 0x1d: r = a >> (b & 31); break;
          case 0x1e: r = (a >>> (b & 31)) | 0; break;
          case 0x20: r = a === b ? 1 : 0; break;
          case 0x21: r = a < b ? 1 : 0; break;
          default: r = (a >>> 0) < (b >>> 0) ? 1 : 0; break;
        }
        sp -= 2; S[sp++] = r; break;
      }
      case 0x30: case 0x31: case 0x32: {
        const rel = ((p[nx - 2] | (p[nx - 1] << 8)) << 16) >> 16;
        let take = true;
        if (op !== 0x30) { const v = S[--sp]; take = op === 0x31 ? v === 0 : v !== 0; }
        if (take) pc = nx + rel;
        break;
      }
      case 0x33:
        if (cp === 64) return done(7);
        C[cp++] = nx; pc = p[nx - 2] | (p[nx - 1] << 8); break;
      case 0x34:
        if (cp === 0) return done(8);
        pc = C[--cp]; break;
      case 0x40: {
        const addr = S[sp - 1];
        if (addr < 0 || addr >= 256) return done(6);
        S[sp - 1] = M[addr]; break;
      }
      case 0x41: {
        const addr = S[sp - 1], v = S[sp - 2];
        if (addr < 0 || addr >= 256) return done(6);
        sp -= 2; M[addr] = v; break;
      }
      case 0x50: {
        const bytes = enc.encode(String(S[sp - 1]));
        if (ol + bytes.length > 65536) return done(11);
        sp--; out.set(bytes, ol); ol += bytes.length; break;
      }
      case 0x51:
        if (ol + 1 > 65536) return done(11);
        out[ol++] = S[--sp] & 255; break;
      case 0x52: S[sp++] = ip < q.length ? q[ip++] : -1; break;
      default: return done(S[--sp] & 255); // 0x53 EXIT
    }
  }
}

// Driver: one run answers every instance in the input directory.
const IN = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const OUT = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';
for (const id of readdirSync(IN).sort()) {
  const prog = readFileSync(join(IN, id, 'program.bin'));
  const inp = readFileSync(join(IN, id, 'input.bin'));
  const r = run(prog, inp);
  mkdirSync(join(OUT, id), { recursive: true });
  writeFileSync(join(OUT, id, 'stdout.bin'), r.o);
  writeFileSync(join(OUT, id, 'exit.txt'), String(r.e) + '\n');
}
