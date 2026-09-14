#!/usr/bin/env python3
"""獨立驗證 attestation canonical bytes 測試向量。

這支腳本刻意**不**引用 Rust 那份實作，而是照 docs/sd.md 3.5 的表格
重新實作一次編碼。兩個獨立實作產生相同位元組，才算真的把格式定死了。

用法：
    python3 scripts/verify-vectors.py backend/src/lib/attestation-vectors.json
"""
import io
import json
import struct
import sys

# 非 UTF-8 locale（例如 CI 或 pyenv 舊版）下輸出中文不得崩潰
if getattr(sys.stdout, "encoding", "").lower() != "utf-8":
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", line_buffering=True)

DOMAIN = b"NEONSHIFT_ATTEST_V1"
LENGTH = 164


def encode(f):
    """依 SD 3.5 表格逐欄位組出 164 bytes。"""
    out = bytearray(LENGTH)

    def put(off, data):
        out[off:off + len(data)] = data

    put(0, DOMAIN)                                          # 0..19
    out[19] = f["version"]                                  # 19
    put(20, bytes.fromhex(f["program_id"]))                 # 20..52
    out[52] = f["cluster_id"]                               # 52
    put(53, bytes.fromhex(f["wallet"]))                     # 53..85
    put(85, struct.pack("<I", f["task_date"]))              # 85..89
    out[89] = f["task_type"]                                # 89
    put(90, struct.pack("<H", f["rules_version"]))          # 90..92
    put(92, bytes.fromhex(f["evidence_hash"]))              # 92..124
    put(124, struct.pack("<q", int(f["issued_at"])))             # 124..132
    put(132, struct.pack("<q", int(f["not_before"])))            # 132..140
    put(140, struct.pack("<q", int(f["expiry"])))                # 140..148
    put(148, bytes.fromhex(f["nonce"]))                     # 148..164

    assert len(out) == LENGTH, "長度必須固定為 164"
    return bytes(out)


def main():
    path = sys.argv[1] if len(sys.argv) > 1 else "backend/src/lib/attestation-vectors.json"
    with open(path, encoding="utf-8") as fh:
        doc = json.load(fh)

    if doc["length"] != LENGTH:
        print("FAIL 向量檔宣告的長度為 %s，預期 %s" % (doc["length"], LENGTH))
        return 1

    failures = []
    for vec in doc["vectors"]:
        actual = encode(vec["fields"]).hex()
        expected = vec["expected_hex"]
        if actual != expected:
            # 找出第一個不同的 byte，方便定位是哪個欄位。
            diff = next(
                (i for i in range(0, len(expected), 2)
                 if actual[i:i + 2] != expected[i:i + 2]),
                None,
            )
            failures.append((vec["name"], diff // 2 if diff is not None else None))
            continue
        if len(bytes.fromhex(expected)) != LENGTH:
            failures.append((vec["name"], "長度錯誤"))

    total = len(doc["vectors"])
    if failures:
        print("FAIL %d/%d 組向量不符" % (len(failures), total))
        for name, off in failures:
            print("  - %s：第一個不同的 byte 位於 offset %s" % (name, off))
        return 1

    print("OK Rust 與 Python 兩個獨立實作在 %d 組向量上位元組完全一致" % total)
    return 0


if __name__ == "__main__":
    sys.exit(main())
