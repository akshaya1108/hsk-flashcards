import json
import unicodedata
import re
import os

def normalize_pinyin(py):
    nfkd = unicodedata.normalize('NFKD', py)
    stripped = ''.join([c for c in nfkd if not unicodedata.combining(c)])
    return re.sub(r'[^a-zA-Z]', '', stripped).lower()

# Handcrafted high-quality sentences for HSK 1-4 and common words not in sentences.json
CURATED_CUSTOM_SENTENCES = {
    '暗': {'zh': '太阳落山了，天渐渐暗了下来。', 'py': 'Tàiyáng luòshān le, tiān jiànjiàn àn le xiàlai.', 'en': 'The sun went down, and the sky gradually darkened.'},
    '报名': {'zh': '我报名参加了学校的球队。', 'py': 'Wǒ bàomíng cānjiā le xuéxiào de qiúduì.', 'en': 'I signed up for the school team.'},
    '回': {'zh': '你什么时候回北京？', 'py': 'Nǐ shénme shíhou huí Běijīng?', 'en': 'When are you returning to Beijing?'},
    '羊肉': {'zh': '我们去吃烤羊肉串吧。', 'py': 'Wǒmen qù chī kǎo yángròuchuàn ba.', 'en': "Let's go eat roasted lamb skewers."},
    '不客气': {'zh': '“谢谢你！”“不客气。”', 'py': '"Xièxie nǐ!" "Bú kèqi."', 'en': '"Thank you!" "You are welcome."'},
    '打篮球': {'zh': '他每天下午都在操场打篮球。', 'py': 'Tā měitiān xiàwǔ dōu zài cāochǎng dǎ lánqiú.', 'en': 'He plays basketball on the playground every afternoon.'},
    '第一': {'zh': '这次考试他拿了全班第一。', 'py': 'Zhè cì kǎoshì tā ná le quán bān dì-yī.', 'en': 'He got first place in the class on this exam.'},
    '火车站': {'zh': '请问去火车站怎么走？', 'py': 'Qǐngwèn qù huǒchēzhàn zěnme zǒu?', 'en': 'Excuse me, how do I get to the train station?'},
    '爸': {'zh': '我爸是一名中学教师。', 'py': 'Wǒ bà shì yì míng zhōngxué jiàoshī.', 'en': 'My dad is a middle school teacher.'},
    '妈': {'zh': '我妈做的红烧肉特别香。', 'py': 'Wǒ mā zuò de hóngshāoròu tèbié xiāng.', 'en': 'The braised pork my mom makes is delicious.'},
    '哥': {'zh': '我哥比我大两岁。', 'py': 'Wǒ gē bǐ wǒ dà liǎng suì.', 'en': 'My older brother is two years older than me.'},
    '姐': {'zh': '我姐下个月就要结婚了。', 'py': 'Wǒ jiě xià ge yuè jiù yào jiéhūn le.', 'en': 'My older sister is getting married next month.'},
    '弟': {'zh': '我弟正在房间里写作业。', 'py': 'Wǒ dì zhèngzài fángjiān lǐ xiě zuòyè.', 'en': 'My younger brother is doing homework in his room.'},
    '妹': {'zh': '我妹长得非常可爱。', 'py': 'Wǒ mèi zhǎng de fēicháng kě\'ài.', 'en': 'My younger sister is very cute.'},
    '有一些': {'zh': '书架上有几本书，有一些是外语书。', 'py': 'Shūjià shàng yǒu jǐ běn shū, yǒuyīxiē shì wàiyǔ shū.', 'en': 'There are a few books on the shelf, some of which are foreign language books.'},
    '正': {'zh': '外面正下着大雨呢。', 'py': 'Wàimiàn zhèng xiàzhe dà yǔ ne.', 'en': 'It is raining heavily outside right now.'},
    '春': {'zh': '春天是一年中最温暖的季节。', 'py': 'Chūntiān shì yì nián zhōng zuì wēnnuǎn de jìjié.', 'en': 'Spring is the warmest season of the year.'},
    '夏': {'zh': '夏天的天气非常炎热。', 'py': 'Xiàtiān de tiānqì fēicháng yánrè.', 'en': 'Summer weather is extremely hot.'},
    '秋': {'zh': '秋天树叶都变成了黄色。', 'py': 'Qiūtiān shùyè dōu biàn chéng le huángsè.', 'en': 'In autumn, the tree leaves turn yellow.'},
    '冬': {'zh': '冬天下雪后到处一片白。', 'py': 'Dōngtiān xiàxuě hòu dàochù yí piàn bái.', 'en': 'After it snows in winter, everywhere is white.'},
    '数学': {'zh': '数学是一门非常重要的基础学科。', 'py': 'Shùxué shì yì mén fēicháng zhòngyào de jīchǔ xuékē.', 'en': 'Math is a very important foundational subject.'},
    '照相机': {'zh': '他用照相机记录了美丽的风景。', 'py': 'Tā yòng zhàoxiàngjī jìlù le měilì de fēngjǐng.', 'en': 'He captured the beautiful scenery with a camera.'},
    '行李箱': {'zh': '他拉着行李箱走出了机场。', 'py': 'Tā lāzhe xínglixiāng zǒu chū le jīchǎng.', 'en': 'He wheeled his suitcase out of the airport.'},
    '差': {'zh': '他的视力比较差，需要戴眼镜。', 'py': 'Tā de shìlì bǐjiào chà, xūyào dài yǎnjìng.', 'en': 'His eyesight is relatively poor and he needs to wear glasses.'},
    '乒乓球': {'zh': '中国人在乒乓球比赛中多次夺冠。', 'py': 'Zhōngguó rén zài pīngpāngqiú bǐsài zhōng duō cì duóguàn.', 'en': 'Chinese players have won many championships in table tennis.'},
    '亚洲': {'zh': '亚洲是世界上面积最大的大洲。', 'py': 'Yàzhōu shì shìjiè shàng miànjī zuì dà de dàzhōu.', 'en': 'Asia is the largest continent in the world by area.'},
    '亲戚': {'zh': '过年的时候很多亲戚来家里做客。', 'py': 'Guònián de shíhou hěnduō qīnqi lái jiālǐ zuòkè.', 'en': 'During the New Year, many relatives came to our home as guests.'},
    '咳嗽': {'zh': '如果咳嗽厉害就要去医院看医生。', 'py': 'Rúguǒ késou lìhai jiù yào qù yīyuàn kàn yīshēng.', 'en': 'If you are coughing severely, you should go see a doctor.'},
    '垃圾桶': {'zh': '请把垃圾分类扔进垃圾桶。', 'py': 'Qǐng bǎ lājī fēnlèi rēng jìn lājītǒng.', 'en': 'Please sort the trash and throw it into the trash can.'},
    '干燥': {'zh': '冬天北方房间里的空气比较干燥。', 'py': 'Dōngtiān běifāng fángjiān lǐ de kōngqì bǐjiào gānzào.', 'en': 'In winter, the air in rooms in the north is relatively dry.'},
    '孤单': {'zh': '一个人生活有时会觉得有点儿孤单。', 'py': 'Yí ge rén shēnghuó yǒushí huì juéde yǒudiǎnr gūdān.', 'en': 'Living alone sometimes feels a bit lonely.'},
    '害羞': {'zh': '他在陌生人面前总是很害羞。', 'py': 'Tā zài mòshēngrén miànqián zǒngshì hěn hàixiū.', 'en': 'He is always very shy in front of strangers.'},
    '放暑假': {'zh': '大学一般在七月初开始放暑假。', 'py': 'Dàxué yībān zài qī yuè chū kāishǐ fàng shǔjià.', 'en': 'Universities generally start summer vacation in early July.'},
    '烦恼': {'zh': '遇到烦恼要学会自我调节。', 'py': 'Yùdào fánnǎo yào xuéhuì zìwǒ tiáojié.', 'en': 'When facing troubles, learn to regulate yourself.'},
    '牙膏': {'zh': '每天早晚刷牙都要用牙膏。', 'py': 'Měitiān zǎowǎn shuāyá dōu yào yòng yágāo.', 'en': 'Use toothpaste when brushing your teeth morning and night.'},
    '狮子': {'zh': '狮子被称为百兽之王。', 'py': 'Shīzi bèi chēng wéi bǎi shòu zhī wáng.', 'en': 'The lion is called the king of beasts.'},
    '猴子': {'zh': '猴子灵巧地爬上了树顶。', 'py': 'Hóuzi língqiǎo de pá shàng le shù dǐng.', 'en': 'The monkey agilely climbed to the top of the tree.'},
    '羡慕': {'zh': '大家都羡慕他拥有一份好工作。', 'py': 'Dàjiā dōu xiànmù tā yōngyǒu yí fèn hǎo gōngzuò.', 'en': 'Everyone admires him for having a good job.'},
    '钥匙': {'zh': '别把钥匙落在屋子里了。', 'py': 'Bié bǎ yàoshi là zài wūzi lǐ le.', 'en': "Don't leave your keys inside the house."},
    '长江': {'zh': '长江全长六千三百多公里。', 'py': 'Chángjiāng quán cháng liùqiān sānbǎi duō gōnglǐ.', 'en': 'The Yangtze River is over 6,300 kilometers long.'},
    '顺便': {'zh': '你去超市时顺便帮我买盒牛奶吧。', 'py': 'Nǐ qù chāoshì shí shùnbiàn bāng wǒ mǎi hé niúnǎi ba.', 'en': 'When you go to the supermarket, please pick up a carton of milk for me.'},
    '马虎': {'zh': '做事马虎容易造成严重的错误。', 'py': 'Zuòshì mǎhu róngyì zàochéng yánzhòng de cuòwù.', 'en': 'Being careless easily leads to serious mistakes.'},
    '森林': {'zh': '大兴安岭有我国最大的天然森林。', 'py': 'Dàxīng\'ānlǐng yǒu wǒ guó zuì dà de tiānrán sēnlín.', 'en': 'The Greater Khingan Mountains have our country\'s largest natural forest.'},
    '流泪': {'zh': '切洋葱的时候很多人会忍不住流泪。', 'py': 'Qiē yángcōng de shíhou hěnduō rén huì rěnbuzhù liúlèi.', 'en': 'When cutting onions, many people cannot help crying.'},
    '湿润': {'zh': '南方雨水充沛，空气非常湿润。', 'py': 'Nánfāng yǔshuǐ chōngpèi, kōngqì fēicháng shīrùn.', 'en': 'The south has abundant rainfall and the air is very humid.'},
    '窄': {'zh': '胡同里的街道非常狭窄。', 'py': 'Hútòng lǐ de jiēdào fēicháng xiázhǎi.', 'en': 'The streets in the hutongs are very narrow.'},
    '底': {'zh': '箱子底部放着几本厚厚的字典。', 'py': 'Xiāngzi dǐbù fàngzhe jǐ běn hòuhòu de zìdiǎn.', 'en': 'At the bottom of the box are a few thick dictionaries.'},
    '之': {'zh': '这是成功的第一步，也是关键之举。', 'py': 'Zhè shì chénggōng de dì-yī bù, yě shì guānjiàn zhī jǔ.', 'en': 'This is the first step to success and also a crucial move.'},
    '无': {'zh': '世上无难事，只怕有心人。', 'py': 'Shìshàng wú nánshì, zhǐ pà yǒuxīnrén.', 'en': 'Nothing in the world is difficult for someone with a willing heart.'},
    '方': {'zh': '有朋自远方来，不亦乐乎？', 'py': 'Yǒu péng zì yuǎnfāng lái, bú yì yuè hū?', 'en': 'Is it not delightful to have friends coming from distant places?'},
    '板': {'zh': '老师在黑板上写下了今天的重点。', 'py': 'Lǎoshī zài hēibǎn shàng xiě xià le jīntiān de zhòngdiǎn.', 'en': 'The teacher wrote today\'s key points on the blackboard.'},
    '初': {'zh': '新学期初我们要制定好学习计划。', 'py': 'Xīn xuéqī chū wǒmen yào zhìdìng hǎo xuéxí jìhuà.', 'en': 'At the beginning of the new semester, we need to make a good study plan.'},
    '力': {'zh': '只要尽力而为，就不会留下遗憾。', 'py': 'Zhǐyào jìnlì ér wéi, jiù bú huì liú xià yíhàn.', 'en': 'As long as you do your best, you will leave no regrets.'},
    '员': {'zh': '他是我们公司最优秀的销售员。', 'py': 'Tā shì wǒmen gōngsī zuì yōuxiù de xiàoshòuyuán.', 'en': 'He is the most outstanding salesperson in our company.'},
    '者': {'zh': '只有勇敢者才能登上顶峰。', 'py': 'Zhǐyǒu yǒnggǎnzhě cáinéng dēng shàng dǐngfēng.', 'en': 'Only the brave can reach the summit.'},
    '指': {'zh': '指针指向了十二点整。', 'py': 'Zhǐzhēn zhǐ xiàng le shí\'èr diǎn zhěng.', 'en': 'The hand pointed exactly to twelve o\'clock.'},
    '通': {'zh': '这条路可以直接通往市中心。', 'py': 'Zhè tiáo lù kěyǐ zhíjiē tōng wǎng shì zhōngxīn.', 'en': 'This road leads directly to the city center.'},
    '遇': {'zh': '在路上遇到了好久不见的老同学。', 'py': 'Zài lù shang yù dào le hǎojiǔ bú jiàn de lǎo tóngxué.', 'en': 'On the road, I bumped into an old classmate I hadn\'t seen in a long time.'},
    '避': {'zh': '雨下得很大，大家都在屋檐下避雨。', 'py': 'Yǔ xià de hěn dà, dàjiā dōu zài wūyán xià bì yǔ.', 'en': 'It was raining hard, and everyone took shelter under the eaves.'},
    '获': {'zh': '经过艰苦训练，她最终获得了冠军。', 'py': 'Jīngguò jiānkǔ xùnliàn, tā zuìzhōng huòdé le guànjūn.', 'en': 'After hard training, she finally won the championship.'},
    '阵': {'zh': '忽然刮起了一阵凉爽的秋风。', 'py': 'Hūrán guā qǐ le yí zhèn liángshuǎng de qiūfēng.', 'en': 'Suddenly a cool autumn breeze blew up.'},
    '隔': {'zh': '他们家和我家只隔了一条小河。', 'py': 'Tāmen jiā hé wǒ jiā zhǐ gé le yì tiáo xiǎohé.', 'en': 'Their home and mine are separated only by a small river.'},
    '非': {'zh': '这绝非偶然，而是长期努力的结果。', 'py': 'Zhè jué fēi ǒurán, ér shì chángqī nǔlì de jiéguǒ.', 'en': 'This is by no means accidental, but the result of long-term effort.'}
}

# Known polyphone overrides for common HSK basic words
POLYPHONE_PINYIN = {
    '看': 'kàn',
    '得': 'de',
    '地': 'de',
    '长': 'cháng',
    '觉': 'jué',
    '教': 'jiào',
    '着': 'zhe',
    '少': 'shǎo'
}

def clean_word_meanings(forms, hanzi):
    exact_forms = [f for f in forms if f.get('t') == hanzi]
    target_forms = exact_forms if exact_forms else forms

    pinyin = POLYPHONE_PINYIN.get(hanzi, '')
    meanings = []

    for f in target_forms:
        if not pinyin:
            pinyin = f.get('i', {}).get('y', '')
        for m in f.get('m', []):
            m_strip = m.strip()
            # Filter out CC-CEDICT cross references and variants
            if not m_strip.lower().startswith(('variant of', 'see ', 'also written as', 'old variant of', 'archaic variant')):
                clean_m = re.sub(r'\s*\(CL:[^)]+\)', '', m_strip)
                if clean_m and clean_m not in meanings:
                    meanings.append(clean_m)

    if not meanings and target_forms:
        for f in target_forms:
            meanings.extend(f.get('m', []))

    clean_meaning = "; ".join(meanings[:3]) if meanings else ""
    return pinyin, clean_meaning

def main():
    print("Loading curated HSK sentences.json (PRIORITY 1)...")
    token_map = {}
    multi_char_sents = []

    with open('data-raw/sentences.json', 'r', encoding='utf-8') as f:
        sents = json.load(f)

    # Sort sentences by length so shorter, crisper sentences are preferred
    sents.sort(key=lambda s: len(s.get('chinese', '')))

    for s in sents:
        zh = s.get('chinese', '').strip()
        py = s.get('pinyin', '').strip()
        en = s.get('translation', {}).get('en', '').strip()
        if not (zh and py and en):
            continue

        item = {'zh': zh, 'py': py, 'en': en}
        multi_char_sents.append(item)

        for t in s.get('tokens', []):
            w = t.get('word', '').strip()
            if w and w not in token_map:
                token_map[w] = item

    print(f"Loaded {len(token_map)} exact token sentence mappings from sentences.json.")

    print("Loading strictly filtered Tatoeba sentences (PRIORITY 4)...")
    tatoeba_clean = {}
    if os.path.exists('data-raw/cmn_sen_db_2.tsv'):
        with open('data-raw/cmn_sen_db_2.tsv', 'r', encoding='utf-8') as f:
            for line in f:
                parts = line.strip().split('\t')
                if len(parts) >= 5:
                    zh, py, en = parts[1].strip(), parts[3].strip(), parts[4].strip()
                    if 6 <= len(zh) <= 24 and 12 <= len(en) <= 85:
                        if en[0].isupper() and en[-1] in ('.', '!', '?'):
                            if not any(bad in en.lower() for bad in [
                                'muiriel', 'tom', 'mary', 'susan', '...', 'http', '@', 
                                'fill the list', 'sign up with two of my white photos',
                                'crush object', 'peaceful night', 'pass away in his sleep'
                            ]):
                                if zh not in tatoeba_clean:
                                    tatoeba_clean[zh] = {'zh': zh, 'py': py, 'en': en}
    print(f"Loaded {len(tatoeba_clean)} clean Tatoeba candidate sentences.")

    print("Loading raw vocabulary...")
    with open('data-raw/complete.min.json', 'r', encoding='utf-8') as f:
        vocab = json.load(f)

    hsk2_levels = {i: [] for i in range(1, 7)}
    hsk3_levels = {i: [] for i in range(1, 7)}

    for v in vocab:
        hanzi = v['s']
        levels = v.get('l', [])
        pinyin, clean_meaning = clean_word_meanings(v.get('f', []), hanzi)

        item_base = {
            'hanzi': hanzi,
            'pinyin': pinyin,
            'pinyin_sort': normalize_pinyin(pinyin),
            'meaning': clean_meaning
        }

        # Check HSK 2.0 (o1-o6)
        old_lvls = [lvl for lvl in levels if lvl in ('o1','o2','o3','o4','o5','o6')]
        if old_lvls:
            lvl_num = min(int(lvl[1]) for lvl in old_lvls)
            hsk2_levels[lvl_num].append({
                **item_base,
                'version': '2.0',
                'level': lvl_num
            })

        # Check HSK 3.0 (n1-n6)
        new_lvls = [lvl for lvl in levels if lvl in ('n1','n2','n3','n4','n5','n6')]
        if new_lvls:
            lvl_num = min(int(lvl[1]) for lvl in new_lvls)
            hsk3_levels[lvl_num].append({
                **item_base,
                'version': '3.0',
                'level': lvl_num
            })

    # Sort alphabetically by normalized pinyin
    for lvl in range(1, 7):
        hsk2_levels[lvl].sort(key=lambda x: (x['pinyin_sort'], x['hanzi']))
        for idx, item in enumerate(hsk2_levels[lvl], start=1):
            item['id'] = idx

        hsk3_levels[lvl].sort(key=lambda x: (x['pinyin_sort'], x['hanzi']))
        for idx, item in enumerate(hsk3_levels[lvl], start=1):
            item['id'] = idx

    def find_best_example(item):
        hz = item['hanzi']

        # 1. Check handcrafted custom sentences (highest precision)
        if hz in CURATED_CUSTOM_SENTENCES:
            return CURATED_CUSTOM_SENTENCES[hz]

        # 2. Check exact token in curated sentences.json
        if hz in token_map:
            return token_map[hz]

        # 3. For multi-character words (len >= 2), check presence in curated sentences.json
        if len(hz) >= 2:
            for s in multi_char_sents:
                if hz in s['zh']:
                    return s

        # 4. For multi-character words, check clean Tatoeba
        if len(hz) >= 2:
            for zh, cand in tatoeba_clean.items():
                if hz in zh:
                    return cand

        # 5. Clean contextual fallback
        m_short = item['meaning'].split(';')[0] if item['meaning'] else hz
        return {
            'zh': f'词语“{hz}”的意思是{m_short}。',
            'py': f'Cíyǔ "{hz}" de yìsi shì {m_short}.',
            'en': f'The word "{hz}" means: {m_short}.'
        }

    def attach_examples(words_list):
        for item in words_list:
            item['example'] = find_best_example(item)

    os.makedirs('data', exist_ok=True)

    # Save HSK 2.0 datasets (hsk2_1.json through hsk2_6.json and aliases)
    print("\n--- Saving HSK 2.0 (Classic) ---")
    for lvl in range(1, 7):
        words = hsk2_levels[lvl]
        attach_examples(words)
        out_file = f'data/hsk2_{lvl}.json'
        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump(words, f, ensure_ascii=False, indent=2)
        print(f"HSK 2.0 Level {lvl}: {len(words)} words saved to {out_file}")
        with open(f'data/hsk{lvl}.json', 'w', encoding='utf-8') as f:
            json.dump(words, f, ensure_ascii=False, indent=2)

    # Save HSK 3.0 datasets (hsk3_1.json through hsk3_6.json)
    print("\n--- Saving HSK 3.0 (New Standard) ---")
    for band in range(1, 7):
        words = hsk3_levels[band]
        attach_examples(words)
        out_file = f'data/hsk3_{band}.json'
        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump(words, f, ensure_ascii=False, indent=2)
        print(f"HSK 3.0 Band {band}: {len(words)} words saved to {out_file}")

    print("\nAll datasets built successfully with clean sentences and definitions!")

if __name__ == '__main__':
    main()
