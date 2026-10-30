# 產生 objcam/vocab.js：python3 objcam/tools/build_vocab.py（需要 pip install pypinyin）
# 資料來源：主網站 index.html 內嵌的教育部《臺灣客語辭典》六腔資料（含錄音檔名），
# 以及 g0v/moedict-data-hakka 的《臺灣客家語常用詞辭典》（補足主網站沒有的詞）。
import json,re,os,base64,zlib,urllib.request
from pypinyin import pinyin, Style
HERE=os.path.dirname(os.path.abspath(__file__))
exec(open(os.path.join(HERE,'concepts.py'),encoding='utf-8').read())
HK=os.path.join(HERE,'dict-hakka.json')
if not os.path.exists(HK):
    urllib.request.urlretrieve('https://raw.githubusercontent.com/g0v/moedict-data-hakka/master/dict-hakka.json',HK)
hk=json.load(open(HK,encoding='utf-8'))
_src=open(os.path.join(HERE,'..','..','index.html'),encoding='utf-8').read()
_pk=json.loads(re.search(r'const PACK=(\{.*?\});\n',_src,re.S).group(1))
pack={d:json.loads(zlib.decompress(base64.b64decode(b))) for d,b in _pk.items()}
SUP=str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹','0123456789')
DCH=" 四海大平安南"
COMPOSE={"汽車","火車","電腦","滑鼠","紅綠燈","紅菜頭"}
M={}
for e in hk:
    t=e['title']
    if t in M: continue
    py=e['heteronyms'][0].get('pinyin','')
    pr={}
    for ch,body in re.findall(r'(.)⃞(\S+)',py):
        d=DCH.find(ch)
        if d<1 or d in pr: continue
        syl=re.findall(r'([a-z]+)(\d+)',body.translate(SUP))
        if syl: pr[d]=' '.join(b+t for b,t in syl)
    M[t]=pr
# 「雞」單字未收：取「火雞」第二音節
for d,v in M['火雞'].items(): M.setdefault('雞',{})[d]=v.split()[1]
P={d:{} for d in range(1,7)}
for d in range(1,7):
    for r in pack[str(d)]:
        P[d].setdefault(r[1],r)
CA={d:{} for d in range(1,7)}
for d in range(1,7):
    for r in pack[str(d)]:
        if len(r[1])==1 and ' ' not in r[2]: CA[d].setdefault((r[1],r[2]),r[3])
def charau(c,d,want):
    return CA[d].get((c,want))
def whole(w,d):
    r=P[d].get(w)
    if r: return dict(w=w,p=r[2],a=[r[3]],s=0,id=r[6])       # 0=臺灣客語辭典整詞錄音
    m=M.get(w,{}).get(d)
    if m:
        syl=m.split()
        ca=[charau(c,d,x) for c,x in zip(w,syl)] if len(syl)==len(w) else [None]
        return dict(w=w,p=m,a=ca if all(ca) else [],s=1)  # 1=常用詞辭典拼音，逐字錄音
    return None
def hakka(w,d):
    x=whole(w,d)
    if x: return x
    if w.endswith('仔') and len(w)>1:
        x=whole(w[:-1],d)
        if x: return x
    if w in COMPOSE:
        cp=[];ca=[]
        for c in w:
            r=P[d].get(c)
            if r and ' ' not in r[2]: cp.append(r[2]); ca.append(r[3])
            else:
                mm=M.get(c,{}).get(d); cp.append(mm); ca.append(None)
        if all(cp): return dict(w=w,p=' '.join(cp),a=ca if all(ca) else [],s=2)  # 2=逐字組合
    if w=='雞' and d in M['雞']:
        return dict(w=w,p=M['雞'][d],a=[],s=1)
    return None
def zhuyin(w):
    out=[]
    for s in pinyin(w,style=Style.BOPOMOFO):
        s=s[0]
        if s.endswith('˙'): s='˙'+s[:-1]
        out.append(s)
    return ' '.join(out)
V=[];COCO={};INET={}
for i,(zh,hw,cat,coco,inet) in enumerate(C):
    h={}
    for d in range(1,7):
        x=hakka(hw,d)
        if x: h[d]=x
    V.append(dict(zh=zh,zy=zhuyin(zh),hk=hw,cat=cat,h=h))
    for l in coco: COCO[l]=i
    for n in inet: INET[n]=i
HEAD='/* 物體詞彙表：國語、注音、六腔客語（由 objcam/tools/build_vocab.py 產生，請勿手動修改）\n   h[腔]={w:客語漢字,p:數字調拼音,a:[錄音檔],s:0臺灣客語辭典整詞錄音|1常用詞辭典拼音(逐字錄音)|2逐字組合,id:辭典編號} */\n'
open(os.path.join(HERE,'..','vocab.js'),'w',encoding='utf-8').write(HEAD+'window.OBJ_VOCAB='+json.dumps(dict(V=V,COCO=COCO,INET=INET),ensure_ascii=False,separators=(',',':'))+';\n')
na=0
for v in V:
    print(v['zh'],v['zy'],v['hk'],' | '.join(f"{d}:{x['w'] if x['w']!=v['hk'] else ''}{x['p']}[{x['s']}{'♪'+str(len(x['a'])) if x['a'] else '✗'}]" for d,x in v['h'].items()))
    na+=sum(1 for x in v['h'].values() if not x['a'])
print('no audio',na,'of',sum(len(v['h']) for v in V), 'concepts',len(V))
