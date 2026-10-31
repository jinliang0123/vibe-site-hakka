# 產生 hakkaocr/dict.json：python3 hakkaocr/tools/build_dict.py
# 資料來源：主網站 index.html 內嵌的教育部《臺灣客語辭典》六腔資料（拼音、錄音、釋義、例句），
# 以及 g0v/moedict-data-hakka 的《臺灣客家語常用詞辭典》（完整釋義、主網站沒有的詞）。
# 以及主網站的國賽字音題庫（補單字讀音）。
# 格式：{詞: [[拼音×6, 錄音×6（或含 # 的樣板字串）, [釋義], [例句], 詞性, 來源(0臺灣客語辭典/1常用詞辭典/2國賽題庫)], ...]}
import json,re,os,base64,zlib,urllib.request
HERE=os.path.dirname(os.path.abspath(__file__))
ROOT=os.path.join(HERE,'..','..')
HK=os.path.join(ROOT,'objcam','tools','dict-hakka.json')
if not os.path.exists(HK):
    urllib.request.urlretrieve('https://raw.githubusercontent.com/g0v/moedict-data-hakka/master/dict-hakka.json',HK)
hk=json.load(open(HK,encoding='utf-8'))
src=open(os.path.join(ROOT,'index.html'),encoding='utf-8').read()
pk=json.loads(re.search(r'const PACK=(\{.*?\});\n',src,re.S).group(1))
pack={int(d):json.loads(zlib.decompress(base64.b64decode(b))) for d,b in pk.items()}
SUP=str.maketrans('⁰¹²³⁴⁵⁶⁷⁸⁹','0123456789')
DCH=" 四海大平安南"

def clean(s): return re.sub(r'\s+',' ',s or '').strip()
def ex_text(e):
    # ￹客語句￻國語翻譯 → 客語句（國語翻譯）
    e=e.replace('￹','').replace('￺','')
    if '￻' in e:
        a,b=e.split('￻',1); a,b=clean(a),clean(b)
        return a+(f'（{b}）' if b else '')
    return clean(e)
def split_defs(s):
    s=clean(s)
    parts=re.split(r'\s*(?:^|\s)\d+\.\s*',s)
    return [p for p in (x.strip() for x in parts) if p]
def pack_ex(e):
    e=clean(e)
    m=re.match(r'^(.*?)\(+（?(.*?)）?\)+$',e)
    return f'{m.group(1)}（{m.group(2)}）' if m and m.group(2) else e

# 1) 臺灣客語辭典：依共同編號 r[6] 合併六腔
G={}
for d in range(1,7):
    for r in pack[d]:
        key=r[6]
        g=G.setdefault(key,{'w':r[1],'p':['']*6,'a':['']*6,'df':split_defs(r[4]),'ex':[pack_ex(r[5])] if r[5] else [],'t':'','s':0})
        if not g['p'][d-1]: g['p'][d-1]=r[2]; g['a'][d-1]=r[3]
D={}
byaudio={}
for key,g in sorted(G.items()):
    D.setdefault(g['w'],[]).append(g)
    for a in g['a']:
        m=re.match(r'hk0*(\d+)-',a or '')
        if m: byaudio[int(m.group(1))]=g
# 2) 常用詞辭典：同一條目（錄音編號相同）補完整釋義；主網站沒有的讀音另外加入
def hk_pron(py):
    p=['']*6
    for ch,body in re.findall(r'(.)⃞(\S+)',py):
        i=DCH.find(ch)
        if i<1 or p[i-1]: continue
        syl=re.findall(r'([a-z]+)(\d+)',body.translate(SUP))
        if syl: p[i-1]=' '.join(b+t for b,t in syl)
    return p
added=0
for e in hk:
    w=e['title']
    if not re.fullmatch(r'[㐀-鿿\U00020000-\U0002ffff]+',w): continue
    for h in e['heteronyms']:
        defs=[clean(x.get('def')) for x in h.get('definitions',[]) if clean(x.get('def'))]
        exs=[ex_text(y) for x in h.get('definitions',[]) for y in x.get('example',[])]
        typ=next((x.get('type') for x in h.get('definitions',[]) if x.get('type')),'')
        aid=int(h['audio_id']) if str(h.get('audio_id','')).isdigit() else None
        g=byaudio.get(aid) if aid else None
        if g and g['w']==w:
            if defs: g['df']=defs
            if exs: g['ex']=exs[:4]
            g['t']=typ; continue
        p=hk_pron(h.get('pinyin',''))
        if not any(p): continue
        same=[x for x in D.get(w,[]) if x['p'][0] and x['p'][0]==p[0]]
        if same:
            if len(defs)>len(same[0]['df']): same[0]['df']=defs
            if not same[0]['ex'] and exs: same[0]['ex']=exs[:4]
            continue
        D.setdefault(w,[]).append({'w':w,'p':p,'a':['']*6,'df':defs,'ex':exs[:4],'t':typ,'s':1}); added+=1
def tmpl(a):
    # 六腔錄音檔名只差腔調編號時，存成一個樣板（# 代表腔調 1~6）
    if not all(a): return a
    for i,c in enumerate(a[0]):
        if c=='1':
            t=a[0][:i]+'#'+a[0][i+1:]
            if all(a[d]==t.replace('#',str(d+1)) for d in range(6)): return t
    return a
# 3) 主網站國賽字音題庫（四縣、海陸、大埔）：補辭典沒有的單字讀音（只有拼音，無錄音、無釋義）
nlc=json.loads(re.search(r'const NLCPACK=(\{.*?\});\n',src,re.S).group(1))
MARK={1:{'ˊ':'24','ˇ':'11','ˋ':('31','2'),'':('55','5')},
      2:{'ˋ':('53','2'),'':('55','5'),'ˊ':'24','ˇ':'11','+':'33'},
      3:{'+':'33','^':('31','21'),'ˋ':('53','54'),'ˇ':'113','ˊ':'35'}}
def digit(syl,d):
    m=re.fullmatch(r'([a-z]+)([ˊˇˋ+^]?)',syl)
    if not m: return None
    t=MARK[d].get(m.group(2))
    if t is None: return None
    if isinstance(t,tuple): t=t[1] if m.group(1)[-1] in 'bdg' else t[0]
    return m.group(1)+t
NEW={}
for d,b in nlc.items():
    d=int(d)
    for r in json.loads(zlib.decompress(base64.b64decode(b))):
        c=r[0]
        if c in D or len(c)!=1: continue
        x=digit(r[1].strip(),d)
        if x: NEW.setdefault(c,['']*6)[d-1]=x
for c,p in NEW.items():
    if not p[5] and p[0]: p[5]=p[0]   # 南四縣與四縣多數同音
    D[c]=[{'w':c,'p':p,'a':['']*6,'df':[],'ex':[],'t':'','s':2}]
print('chars from 國賽題庫',len(NEW))
out={w:[[g['p'],tmpl(g['a']),g['df'],g['ex'],g['t'],g['s']] for g in gs] for w,gs in D.items()}
dst=os.path.join(HERE,'..','dict.json')
json.dump(out,open(dst,'w',encoding='utf-8'),ensure_ascii=False,separators=(',',':'))
print('words',len(out),'readings',sum(len(v) for v in out.values()),'added from 常用詞',added,'bytes',os.path.getsize(dst))
for t in ['車','汽','學校','讀','額','汽車']: print(t,json.dumps(out.get(t),ensure_ascii=False)[:400])
