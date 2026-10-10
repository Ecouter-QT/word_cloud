import io, sys

SRC = r'D:\AI\project\word_cloud\tools\gold_sentences.txt'
OUT = r'D:\AI\project\word_cloud\data\gold.txt'

src_raw = open(SRC, 'rb').read()
assert not src_raw.startswith(b'\xef\xbb\xbf'), 'src has BOM'
src_text = src_raw.decode('utf-8')
originals = []
for line in src_text.split('\n'):
    if line == '':
        continue
    num, tab, sent = line.partition('\t')
    assert tab == '\t', 'no tab in line: %r' % line
    originals.append((num.strip(), sent))
print('originals:', len(originals))

out_raw = open(OUT, 'rb').read()
assert not out_raw.startswith(b'\xef\xbb\xbf'), 'out has BOM'
assert b'\r' not in out_raw, 'out has CR'
out_text = out_raw.decode('utf-8')

blocks = []
cur = None
for line in out_text.split('\n'):
    if line == '':
        continue
    if line.startswith('# '):
        cur = (line[2:].strip(), [])
        blocks.append(cur)
    else:
        assert cur is not None, 'content before first # marker'
        cur[1].append(line)
print('blocks:', len(blocks))

ok = 0
total_tokens = 0
for i, (num, sent) in enumerate(originals):
    if i >= len(blocks):
        print('# %s FAIL (missing block)' % num)
        continue
    bnum, blines = blocks[i]
    if bnum != num:
        print('# %s FAIL (block number mismatch: got %s)' % (num, bnum))
        continue
    annotated = ''.join(blines)
    tokens = annotated.split('/')
    recon = ''.join(tokens)
    total_tokens += len(tokens)
    if recon == sent:
        ok += 1
        print('# %s PASS (%d tokens)' % (num, len(tokens)))
    else:
        print('# %s FAIL' % num)
        print('   original: %r' % sent)
        print('   recon   : %r' % recon)
        # show first difference
        for k in range(min(len(sent), len(recon))):
            if sent[k] != recon[k]:
                print('   first diff at index %d: orig %r vs recon %r' % (k, sent[k], recon[k]))
                break
        else:
            print('   length differs: orig %d vs recon %d' % (len(sent), len(recon)))

print('---')
print('PASS %d/%d' % (ok, len(originals)))
print('total tokens: %d' % total_tokens)
assert len(blocks) == len(originals), 'block count %d != sentence count %d' % (len(blocks), len(originals))
sys.exit(0 if ok == len(originals) else 1)
