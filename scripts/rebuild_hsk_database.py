import json
import zipfile
import sqlite3
import unicodedata
import re
import os
import tempfile
import html
from collections import defaultdict

# --- Helper string & text cleaners ---

def clean_text(text):
    if not text:
        return ''
    text = re.sub(r'<br\s*/?>', ' ', text, flags=re.I)
    text = re.sub(r'<[^>]+>', ' ', text)
    text = html.unescape(text)
    text = text.replace('\xa0', ' ').replace('\u200b', '')
    text = re.sub(r'\s+', ' ', text).strip()
    return text

def normalize_hanzi(hz):
    hz = clean_text(hz)
    return unicodedata.normalize('NFKC', hz).strip().replace('\u200b', '')

def normalize_pinyin(py):
    if not py:
        return ''
    nfkd = unicodedata.normalize('NFKD', py)
    stripped = ''.join([c for c in nfkd if not unicodedata.combining(c)])
    return re.sub(r'[^a-zA-Z]', '', stripped).lower()

CURATED_CUSTOM_ENTRIES = {
    '炮': {
        'pinyin': 'pào',
        'meaning': 'cannon; artillery; firecracker',
        'example': {
            'zh': '过年的时候，孩子们喜欢在院子里放鞭炮。',
            'py': 'Guònián de shíhou, háizimen xǐhuan zài yuànzi lǐ fàng biānpào.',
            'en': 'During the New Year, children like to set off firecrackers in the yard.'
        }
    },
    '挨': {
        'pinyin': 'ái',
        'meaning': 'to suffer, to endure; to get (criticized, scolded, beaten)',
        'example': {
            'zh': '他因为上班迟到挨了经理的批评。',
            'py': 'Tā yīnwèi shàngbān chídào ái le jīnglǐ de pīpíng.',
            'en': 'He got criticized by the manager for being late to work.'
        }
    },
    '暗': {
        'pinyin': 'àn',
        'meaning': 'dark, dim; gloomy; hidden',
        'example': {
            'zh': '走廊里的灯坏了，四周非常暗。',
            'py': 'Zǒuláng lǐ de dēng huài le, sìzhōu fēicháng àn.',
            'en': 'The light in the hallway is broken, and it is very dark all around.'
        }
    },
    '报名': {
        'pinyin': 'bàomíng',
        'meaning': 'to sign up; to register; to enroll',
        'example': {
            'zh': '我报名参加了今年的马拉松比赛。',
            'py': 'Wǒ bàomíng cānjiā le jīnnián de mǎlāsōng bǐsài.',
            'en': 'I signed up to participate in this year\'s marathon.'
        }
    },
    '北京': {
        'pinyin': 'Běijīng',
        'meaning': 'Beijing (capital of China)',
        'example': {
            'zh': '我打算明年秋天去北京旅游。',
            'py': 'Wǒ dǎsuàn míngnián qiūtiān qù Běijīng lǚyóu.',
            'en': 'I plan to travel to Beijing next autumn.'
        }
    },
    '火车站': {
        'pinyin': 'huǒchēzhàn',
        'meaning': 'train station, railway station',
        'example': {
            'zh': '请问去火车站坐哪一路公交车？',
            'py': 'Qǐngwèn qù huǒchēzhàn zuò nǎ yí lù gōngjiāochē?',
            'en': 'Excuse me, which bus goes to the train station?'
        }
    },
    '没': {
        'pinyin': 'méi',
        'meaning': 'not have; there is not; haven\'t',
        'example': {
            'zh': '我今天早上太忙，还没吃早饭。',
            'py': 'Wǒ jīntiān zǎoshang tài máng, hái méi chī zǎofàn.',
            'en': 'I was too busy this morning and have not had breakfast yet.'
        }
    },
    '唱歌': {
        'pinyin': 'chànggē',
        'meaning': 'to sing a song',
        'example': {
            'zh': '她唱歌唱得非常动听。',
            'py': 'Tā chànggē chàng de fēicháng dòngtīng.',
            'en': 'She sings songs very beautifully.'
        }
    },
    '打篮球': {
        'pinyin': 'dǎ lánqiú',
        'meaning': 'to play basketball',
        'example': {
            'zh': '他每天放学后都在操场打篮球。',
            'py': 'Tā měitiān fàngxué hòu dōu zài cāochǎng dǎ lánqiú.',
            'en': 'He plays basketball on the sports field every day after school.'
        }
    },
    '第一': {
        'pinyin': 'dì-yī',
        'meaning': 'first; number one; primary',
        'example': {
            'zh': '这次期末考试他考了全班第一。',
            'py': 'Zhè cì qīmò kǎoshì tā kǎo le quán bān dì-yī.',
            'en': 'He placed first in the whole class in this final exam.'
        }
    },
    '服务员': {
        'pinyin': 'fúwùyuán',
        'meaning': 'waiter; waitress; server; attendant',
        'example': {
            'zh': '服务员，请帮我们拿一份菜单，谢谢。',
            'py': 'Fúwùyuán, qǐng bāng wǒmen ná yí fèn càidān, xièxie.',
            'en': 'Waiter, please bring us a menu, thank you.'
        }
    },
    '公共汽车': {
        'pinyin': 'gōnggòng qìchē',
        'meaning': 'bus (public transit)',
        'example': {
            'zh': '我每天早晨坐公共汽车去公司上班。',
            'py': 'Wǒ měitiān zǎochén zuò gōnggòng qìchē qù gōngsī shàngbān.',
            'en': 'I take the public bus to work every morning.'
        }
    },
    '羊肉': {
        'pinyin': 'yángròu',
        'meaning': 'mutton; lamb meat',
        'example': {
            'zh': '冬天吃热气腾腾的烤羊肉特别暖和。',
            'py': 'Dōngtiān chī rèqì téngténg de kǎo yángròu tèbié nuǎnhuo.',
            'en': 'Eating steaming roasted lamb in winter is especially warming.'
        }
    },
    '不客气': {
        'pinyin': 'bú kèqi',
        'meaning': 'you\'re welcome; don\'t mention it',
        'example': {
            'zh': '“非常感谢你的帮助！”“不用客气！”',
            'py': '"Fēicháng gǎnxiè nǐ de bāngzhù!" "Bú yòng kèqi!"',
            'en': '"Thank you very much for your help!" "You\'re welcome!"'
        }
    },
    '春': {
        'pinyin': 'chūn',
        'meaning': 'spring (season); springtime',
        'example': {
            'zh': '春暖花开，正是外出踏青的好时节。',
            'py': 'Chūn nuǎn huā kāi, zhèng shì wàichū tàqīng de hǎo shíjié.',
            'en': 'Spring brings warm weather and blooming flowers, a great time for an outing.'
        }
    },
    '夏': {
        'pinyin': 'xià',
        'meaning': 'summer (season)',
        'example': {
            'zh': '夏天的海边是避暑的最佳去处。',
            'py': 'Xiàtiān de hǎibiān shì bìshǔ de zuì jiā qùchù.',
            'en': 'The seaside in summer is the best place to escape the heat.'
        }
    },
    '秋': {
        'pinyin': 'qiū',
        'meaning': 'autumn; fall (season)',
        'example': {
            'zh': '秋天到了，树上的树叶渐渐变黄飘落。',
            'py': 'Qiūtiān dào le, shù shàng de shùyè jiànjiàn biàn huáng piāoluò.',
            'en': 'Autumn has arrived, and leaves on the trees gradually turn yellow and drift down.'
        }
    },
    '冬': {
        'pinyin': 'dōng',
        'meaning': 'winter (season)',
        'example': {
            'zh': '冬天下大雪后，到处都是白茫茫的一片。',
            'py': 'Dōngtiān xià dàxuě hòu, dàochù dōu shì bái mángmáng de yí piàn.',
            'en': 'After heavy snow in winter, everything turns vast and white.'
        }
    },
    '绿': {
        'pinyin': 'lǜ',
        'meaning': 'green',
        'example': {
            'zh': '雨后的小草显得格外鲜绿。',
            'py': 'Yǔ hòu de xiǎocǎo xiǎnde géwài xiānlǜ.',
            'en': 'After the rain, the grass looks exceptionally fresh and green.'
        }
    },
    '电子': {
        'pinyin': 'diànzǐ',
        'meaning': 'electronic; electron',
        'example': {
            'zh': '现在大家都习惯阅读电子书和电子报纸。',
            'py': 'Xiànzài dàjiā dōu xíguàn yuèdú diànzǐshū hé diànzǐ bàozhǐ.',
            'en': 'Now everyone is accustomed to reading e-books and electronic newspapers.'
        }
    },
    '面条': {
        'pinyin': 'miàntiáo',
        'meaning': 'noodles',
        'example': {
            'zh': '我中午在学校食堂吃了一碗热牛肉面条。',
            'py': 'Wǒ zhōngwǔ zài xuéxiào shítáng chī le yì wǎn rè niúròu miàntiáo.',
            'en': 'I ate a bowl of hot beef noodles at the school cafeteria at noon.'
        }
    },
    '爬山': {
        'pinyin': 'páshān',
        'meaning': 'to climb a mountain; to hike',
        'example': {
            'zh': '我们每个周末都约朋友一起去郊外爬山。',
            'py': 'Wǒmen měi ge zhōumò dōu yuē péngyou yìqǐ qù jiāowài páshān.',
            'en': 'Every weekend we arrange with friends to hike in the mountains outside the city.'
        }
    },
    '行李箱': {
        'pinyin': 'xínglixiāng',
        'meaning': 'suitcase; luggage',
        'example': {
            'zh': '他拉着重重的行李箱快步走向登机口。',
            'py': 'Tā lāzhe zhòngzhòng de xínglixiāng kuàibù zǒuxiàng dēngjīkǒu.',
            'en': 'He pulled his heavy suitcase and walked briskly towards the boarding gate.'
        }
    },
    '熊猫': {
        'pinyin': 'xióngmāo',
        'meaning': 'panda, giant panda',
        'example': {
            'zh': '大熊猫憨态可掬，深受全世界人们的喜爱。',
            'py': 'Dàxióngmāo hāntài-kějū, shēn shòu quán shìjiè rénmen de xǐ\'ài.',
            'en': 'Giant pandas are delightfully charming and deeply loved by people all over the world.'
        }
    },
    '照相机': {
        'pinyin': 'zhàoxiàngjī',
        'meaning': 'camera',
        'example': {
            'zh': '他用手中的照相机定格了夕阳西下的美景。',
            'py': 'Tā yòng shǒuzhōng de zhàoxiàngjī dìnggé le xīyáng xī xià de měijǐng.',
            'en': 'He captured the beautiful sunset with the camera in his hands.'
        }
    },
    '抽烟': {
        'pinyin': 'chōuyān',
        'meaning': 'to smoke (cigarettes)',
        'example': {
            'zh': '医院和商场等公共室内场所严禁抽烟。',
            'py': 'Yīyuàn hé shāngchǎng děng gōnggòng shìnèi chǎngsuǒ yánjìn chōuyān.',
            'en': 'Smoking is strictly prohibited in public indoor spaces such as hospitals and malls.'
        }
    },
    '大使馆': {
        'pinyin': 'dàshǐguǎn',
        'meaning': 'embassy',
        'example': {
            'zh': '出国留学前需要先去大使馆办理签证。',
            'py': 'Chūguó liúxué qián xūyào xiān qù dàshǐguǎn bànlǐ qiānzhèng.',
            'en': 'Before studying abroad, you need to go to the embassy to get a visa.'
        }
    },
    '放暑假': {
        'pinyin': 'fàng shǔjià',
        'meaning': 'to have summer vacation; summer break',
        'example': {
            'zh': '七月份学校放暑假后，很多学生会去旅行。',
            'py': 'Qī yuèfèn xuéxiào fàng shǔjià hòu, hěnduō xuésheng huì qù lǚxíng.',
            'en': 'After schools start summer vacation in July, many students go traveling.'
        }
    },
    '分之': {
        'pinyin': 'fēn zhī',
        'meaning': 'fraction marker (e.g. 三分之一 = one third; 百分之 = percent)',
        'example': {
            'zh': '地球表面大约有百分之七十被海洋覆盖。',
            'py': 'Dìqiú biǎomiàn dàyuē yǒu bǎifēnzhī qīshí bèi hǎiyáng fùgài.',
            'en': 'Approximately seventy percent of the Earth\'s surface is covered by oceans.'
        }
    },
    '孤单': {
        'pinyin': 'gūdān',
        'meaning': 'lonely, solitary',
        'example': {
            'zh': '独处异乡的他偶尔会感到一些孤单。',
            'py': 'Dúchǔ yìxiāng de tā ǒu\'ěr huì gǎndào yìxiē gūdān.',
            'en': 'Living alone in a foreign land, he occasionally feels somewhat lonely.'
        }
    },
    '垃圾桶': {
        'pinyin': 'lājītǒng',
        'meaning': 'trash can, garbage bin',
        'example': {
            'zh': '请将分类好的生活垃圾投入对应的垃圾桶。',
            'py': 'Qǐng jiāng fēnlèi hǎo de shēnghuó lājī tóurù duìyìng de lājītǒng.',
            'en': 'Please put sorted household waste into the corresponding trash bins.'
        }
    },
    '聊天': {
        'pinyin': 'liáotiān',
        'meaning': 'to chat; to talk informally',
        'example': {
            'zh': '我和老朋友一边喝茶一边开心地聊天。',
            'py': 'Wǒ hé lǎo péngyou yìbiān hēchá yìbiān kāixīn de liáotiān.',
            'en': 'I chatted happily with old friends while drinking tea.'
        }
    },
    '流泪': {
        'pinyin': 'liúlèi',
        'meaning': 'to shed tears; to weep; to cry',
        'example': {
            'zh': '这部感人的电影让在场很多观众悄悄流泪。',
            'py': 'Zhè bù gǎnrén de diànyǐng ràng zàichǎng hěnduō guānzhòng qiāoqiāo liúlèi.',
            'en': 'This touching movie made many audience members shed tears quietly.'
        }
    },
    '湿润': {
        'pinyin': 'shīrùn',
        'meaning': 'moist; humid; damp',
        'example': {
            'zh': '南方春天多雨，空气非常湿润清新。',
            'py': 'Nánfāng chūntiān duōyǔ, kōngqì fēicháng shīrùn qīngxīn.',
            'en': 'Spring in the south has plenty of rain, and the air is very moist and fresh.'
        }
    },
    '售货员': {
        'pinyin': 'shòuhuòyuán',
        'meaning': 'salesperson; shop assistant',
        'example': {
            'zh': '百货商店的售货员热情地为顾客介绍商品。',
            'py': 'Bǎihuò shāngdiàn de shòuhuòyuán rèqíng de wèi gùkè jièshào shāngpǐn.',
            'en': 'The salesperson in the department store warmly introduced products to customers.'
        }
    },
    '塑料袋': {
        'pinyin': 'sùliàodài',
        'meaning': 'plastic bag',
        'example': {
            'zh': '为了保护生态环境，我们应尽量减少使用塑料袋。',
            'py': 'Wèile bǎohù shēngtài huánjìng, wǒmen yīng jǐnliàng jiǎnshǎo shǐyòng sùliàodài.',
            'en': 'To protect the ecological environment, we should minimize the use of plastic bags.'
        }
    },
    '填空': {
        'pinyin': 'tiánkòng',
        'meaning': 'to fill in the blanks (on a test/form)',
        'example': {
            'zh': '请仔细阅读题目要求，完成下面的填空题。',
            'py': 'Qǐng zǐxì yuèdú tímù yāoqiú, wánchéng xiàmiàn de tiánkòngtí.',
            'en': 'Please read the question requirements carefully and complete the fill-in-the-blank questions below.'
        }
    },
    '长城': {
        'pinyin': 'Chángchéng',
        'meaning': 'The Great Wall of China',
        'example': {
            'zh': '雄伟的万里长城吸引了成千上万的海内外游客。',
            'py': 'Xióngwěi de Wànlǐ Chángchéng xīyǐn le chéngqiān-shàngwàn de hǎinèiwài yóukè.',
            'en': 'The magnificent Great Wall attracts tens of thousands of domestic and foreign tourists.'
        }
    },
    '长江': {
        'pinyin': 'Chángjiāng',
        'meaning': 'Yangtze River (Chang Jiang)',
        'example': {
            'zh': '长江是中国第一大河，也是中华民族的母亲河之一。',
            'py': 'Chángjiāng shì Zhōngguó dì-yī dà hé, yě shì Zhōnghuá mínzú de mǔqīn hé zhī yī.',
            'en': 'The Yangtze River is China\'s longest river and one of the mother rivers of the Chinese nation.'
        }
    },
    '做生意': {
        'pinyin': 'zuò shēngyi',
        'meaning': 'to do business; to trade',
        'example': {
            'zh': '做生意最重要的是讲究诚信和客户口碑。',
            'py': 'Zuò shēngyi zuì zhòngyào de shì jiǎngjiu chéngxìn hé kèhù kǒubēi.',
            'en': 'The most important thing in doing business is emphasizing honesty and customer reputation.'
        }
    },
    '鞭炮': {
        'pinyin': 'biānpào',
        'meaning': 'firecrackers; string of firecrackers',
        'example': {
            'zh': '除夕夜伴随着热闹的鞭炮声，新年拉开了序幕。',
            'py': 'Chúxī yè bànsuízhe rènao de biānpàoshēng, xīnnián lākāi le xùmù.',
            'en': 'On New Year\'s Eve, accompanied by the lively sound of firecrackers, the new year began.'
        }
    },
    '怪不得': {
        'pinyin': 'guàibude',
        'meaning': 'no wonder; so that\'s why',
        'example': {
            'zh': '原来他提前练习了很久，怪不得发挥得这么出色。',
            'py': 'Yuánlái tā tíqián liànxí le hěnjiǔ, guàibude fāhuī de zhème chūsè.',
            'en': 'Turns out he practiced in advance for a long time; no wonder he performed so well.'
        }
    },
    '糊涂': {
        'pinyin': 'hútu',
        'meaning': 'confused; muddled; foolish',
        'example': {
            'zh': '我今天太累了，脑子昏昏沉沉有点儿糊涂。',
            'py': 'Wǒ jīntiān tài lèi le, nǎozi hūnhūn-chénchén yǒudiǎnr hútu.',
            'en': 'I am too tired today and feel groggy and a bit muddled.'
        }
    },
    '爱不释手': {
        'pinyin': 'ài bù shì shǒu',
        'meaning': 'to love sth too much to part with it (idiom)',
        'example': {
            'zh': '他对这本精美的摄影集喜爱至极，简直爱不释手。',
            'py': 'Tā duì zhè běn jīngměi de shèyǐngjí xǐ\'ài zhìjí, jiǎnzhí ài bù shì shǒu.',
            'en': 'He loved this exquisite photography album so much that he couldn\'t bear to put it down.'
        }
    },
    '安居乐业': {
        'pinyin': 'ān jū lè yè',
        'meaning': 'to live in peace and work happily (idiom)',
        'example': {
            'zh': '国家繁荣昌盛，人民才能安居乐业。',
            'py': 'Guójiā fánróng chāngshèng, rénmín cáinéng ānjū-lèyè.',
            'en': 'Only when the country is prosperous can the people live in peace and work happily.'
        }
    },
    '拔苗助长': {
        'pinyin': 'bá miáo zhù zhǎng',
        'meaning': 'to spoil things through excessive enthusiasm (idiom)',
        'example': {
            'zh': '教育孩子要循序渐进，千万不能拔苗助长。',
            'py': 'Jiàoyù háizi yào xúnxù-jiànjìn, qiānwàn bùnéng bámiáo-zhùzhǎng.',
            'en': 'Educating children requires gradual progress; one must never rush things and ruin them.'
        }
    },
    '把关': {
        'pinyin': 'bǎguān',
        'meaning': 'to check on sth; to guard a pass; quality control',
        'example': {
            'zh': '技术总监亲自为新产品的每一个环节把关。',
            'py': 'Jìshù zǒngjiān qīnzì wèi xīn chǎnpǐn de měi yí ge huánjié bǎguān.',
            'en': 'The technical director personally checks every stage of the new product.'
        }
    },
    '半途而废': {
        'pinyin': 'bàn tú ér fèi',
        'meaning': 'to give up halfway; to leave unfinished (idiom)',
        'example': {
            'zh': '做事情最忌讳半途而废，坚持到底才能迎来成功。',
            'py': 'Zuò shìqing zuì jìhuì bàntú\'érfèi, jiānchí dàodǐ cáinéng yínglái chénggōng.',
            'en': 'The worst thing is giving up halfway; only persisting to the end brings success.'
        }
    },
    '饱经沧桑': {
        'pinyin': 'bǎo jīng cāngsāng',
        'meaning': 'having experienced the vicissitudes of life (idiom)',
        'example': {
            'zh': '老人饱经沧桑的面孔上刻满了岁月的痕迹。',
            'py': 'Lǎorén bǎojīng-cāngsāng de miànkǒng shàng kè mǎn le suìyuè de hénjì.',
            'en': 'The old man\'s weather-beaten face was etched with the marks of time.'
        }
    }
}

POLYPHONE_PINYIN_MAP = {
    '看': {1: 'kàn', 2: 'kàn', 3: 'kàn', 4: 'kàn', 5: 'kān', 6: 'kàn'},
    '得': {2: 'de', 3: 'dé', 4: 'de', 5: 'de', 6: 'dé'},
    '地': {2: 'de', 3: 'dì', 4: 'de', 5: 'dì', 6: 'dì'},
    '长': {2: 'cháng', 3: 'zhǎng', 4: 'cháng', 5: 'cháng', 6: 'zhǎng'},
    '着': {2: 'zhe', 3: 'zhe', 4: 'zhe', 5: 'zhe', 6: 'zhe'},
    '少': {1: 'shǎo', 2: 'shǎo', 3: 'shǎo', 4: 'shǎo', 5: 'shǎo', 6: 'shǎo'},
    '觉': {2: 'jué', 3: 'jué', 4: 'jué', 5: 'jué', 6: 'jué'},
    '教': {2: 'jiào', 3: 'jiāo', 4: 'jiào', 5: 'jiào', 6: 'jiào'},
    '还': {1: 'hái', 2: 'hái', 3: 'huán', 4: 'hái', 5: 'hái', 6: 'huán'},
    '只': {1: 'zhī', 2: 'zhī', 3: 'zhǐ', 4: 'zhǐ', 5: 'zhǐ', 6: 'zhǐ'},
    '炮': {1: 'pào', 2: 'pào', 3: 'pào', 4: 'pào', 5: 'pào', 6: 'pào'},
    '挨': {1: 'ái', 2: 'ái', 3: 'ái', 4: 'ái', 5: 'ái', 6: 'ái'}
}

def clean_word_meanings_from_forms(forms, hanzi):
    exact_forms = [f for f in forms if f.get('t') == hanzi]
    target_forms = exact_forms if exact_forms else forms

    meanings = []
    pinyin = ''
    for f in target_forms:
        if not pinyin:
            pinyin = f.get('i', {}).get('y', '')
        for m in f.get('m', []):
            m_strip = clean_text(m)
            if not m_strip.lower().startswith(('variant of', 'see ', 'also written as', 'old variant of', 'archaic variant')):
                clean_m = re.sub(r'\s*\(CL:[^)]+\)', '', m_strip)
                clean_m = re.sub(r'^\(idiom\)\s*', '', clean_m, flags=re.I)
                clean_m = re.sub(r'\s*\(idiom\)$', '', clean_m, flags=re.I)
                if clean_m and clean_m not in meanings:
                    meanings.append(clean_m)
    if not meanings and target_forms:
        for f in target_forms:
            meanings.extend([clean_text(m) for m in f.get('m', [])])

LEVEL_APPROPRIATE_SENTENCE_OVERRIDES = {
    ('中', 'zhōng'): {
        'zh': '我们中间有三个人是老师。',
        'py': 'Wǒmen zhōngjiān yǒu sān gè rén shì lǎoshī.',
        'en': 'Among us, three people are teachers.'
    },
    ('为', 'wèi'): {
        'zh': '爸爸每天努力工作，为了让我们生活得更好。',
        'py': 'Bàba měitiān nǔlì gōngzuò, wèile ràng wǒmen shēnghuó de gèng hǎo.',
        'en': 'Dad works hard every day to make our lives better.'
    },
    ('只', 'zhī'): {
        'zh': '树上有一只小鸟。',
        'py': 'Shù shàng yǒu yì zhī xiǎoniǎo.',
        'en': 'There is a little bird in the tree.'
    },
    ('只', 'zhǐ'): {
        'zh': '我只有一个哥哥，没有姐姐。',
        'py': 'Wǒ zhǐ yǒu yí gè gēge, méiyǒu jiějie.',
        'en': 'I only have one older brother; I do not have an older sister.'
    },
    ('地', 'de'): {
        'zh': '妹妹高兴地笑了。',
        'py': 'Mèimei gāoxìng de xiào le.',
        'en': 'Younger sister smiled happily.'
    },
    ('地', 'dì'): {
        'zh': '地上有很多水，走路请小心。',
        'py': 'Dì shàng yǒu hěnduō shuǐ, zǒulù qǐng xiǎoxīn.',
        'en': 'There is a lot of water on the ground; please be careful walking.'
    },
    ('地方', 'dìfang'): {
        'zh': '这个地方很漂亮，我想再去一次。',
        'py': 'Zhège dìfang hěn piàoliang, wǒ xiǎng zài qù yí cì.',
        'en': 'This place is very beautiful; I want to go again.'
    },
    ('好', 'hǎo'): {
        'zh': '你好，很高兴认识你！',
        'py': 'Nǐ hǎo, hěn gāoxìng rènshi nǐ!',
        'en': 'Hello, nice to meet you!'
    },
    ('得', 'de'): {
        'zh': '他说汉语说得很好。',
        'py': 'Tā shuō hànyǔ shuō de hěn hǎo.',
        'en': 'He speaks Chinese very well.'
    },
    ('得', 'dé'): {
        'zh': '他在这次汉语比赛中得了第一名。',
        'py': 'Tā zài zhè cì hànyǔ bǐsài zhōng dé le dì-yī míng.',
        'en': 'He won first place in this Chinese competition.'
    },
    ('得', 'děi'): {
        'zh': '时间不早了，我得回家了。',
        'py': 'Shíjiān bù zǎo le, wǒ děi huí jiā le.',
        'en': 'It is getting late; I must go home.'
    },
    ('数', 'shù'): {
        'zh': '他的数学成绩非常好，经常考一百分。',
        'py': 'Tā de shùxué chéngjì fēicháng hǎo, jīngcháng kǎo yībǎi fēn.',
        'en': 'His math grades are very good; he often scores 100 points.'
    },
    ('看', 'kàn'): {
        'zh': '我喜欢在家里看书。',
        'py': 'Wǒ xǐhuan zài jiālǐ kàn shū.',
        'en': 'I like reading books at home.'
    },
    ('着', 'zhe'): {
        'zh': '门开着，请进吧。',
        'py': 'Mén kāi zhe, qǐng jìn ba.',
        'en': 'The door is open; please come in.'
    },
    ('着', 'zháo'): {
        'zh': '昨天晚上我喝了咖啡，很晚才睡着。',
        'py': 'Zuótiān wǎnshang wǒ hē le kāfēi, hěn wǎn cái shuìzháo.',
        'en': 'I drank coffee last night and fell asleep very late.'
    },
    ('种', 'zhǒng'): {
        'zh': '这家超市里有许多种新鲜的水果。',
        'py': 'Zhè jiā chāoshì lǐ yǒu xǔduō zhǒng xīnxiān de shuǐguǒ.',
        'en': 'There are many kinds of fresh fruit in this supermarket.'
    },
    ('种', 'zhòng'): {
        'zh': '爷爷在院子里种了很多漂亮的花。',
        'py': 'Yéye zài yuànzi lǐ zhòng le hěnduō piàoliang de huā.',
        'en': 'Grandpa planted many beautiful flowers in the yard.'
    },
    ('空', 'kōng'): {
        'zh': '今天天气很好，蓝蓝的天空上没有一朵云。',
        'py': 'Jīntiān tiānqì hěn hǎo, lánlán de tiānkōng shàng méiyǒu yì duǒ yún.',
        'en': 'The weather is great today; there is not a single cloud in the blue sky.'
    },
    ('落', 'luò'): {
        'zh': '秋天到了，树叶慢慢地落了下来。',
        'py': 'Qiūtiān dào le, shùyè mànman de luò le xiàlai.',
        'en': 'Autumn has arrived, and leaves slowly fell down.'
    },
    ('行', 'xíng'): {
        'zh': '我们明天下午三点见面，行吗？',
        'py': 'Wǒmen míngtiān xiàwǔ sān diǎn jiànmiàn, xíng ma?',
        'en': 'We meet tomorrow afternoon at three o\'clock, is that okay?'
    },
    ('过', 'guò'): {
        'zh': '过马路的时候要看车，注意安全。',
        'py': 'Guò mǎlù de shíhou yào kàn chē, zhùyì ānquán.',
        'en': 'When crossing the street, watch for cars and pay attention to safety.'
    },
    ('过', 'guo'): {
        'zh': '我去过中国，吃过北京烤鸭。',
        'py': 'Wǒ qùguo Zhōngguó, chīguo Běijīng kǎoyā.',
        'en': 'I have been to China and eaten Peking duck.'
    },
    ('还', 'hái'): {
        'zh': '已经十点了，他还在工作。',
        'py': 'Yǐjīng shí diǎn le, tā hái zài gōngzuò.',
        'en': 'It is already ten o\'clock, but he is still working.'
    },
    ('还', 'huán'): {
        'zh': '我从图书馆借了一本书，明天要去还书。',
        'py': 'Wǒ cóng túshūguǎn jiè le yì běn shū, míngtiān yào qù huán shū.',
        'en': 'I borrowed a book from the library and need to return it tomorrow.'
    },
    ('重', 'chóng'): {
        'zh': '老师让我们把这篇作业重新做一遍。',
        'py': 'Lǎoshī ràng wǒmen bǎ zhè piān zuòyè chóngxīn zuò yí biàn.',
        'en': 'The teacher asked us to do this homework assignment once again.'
    },
    ('量', 'liáng'): {
        'zh': '医生给病人量了体温，发现他发烧了。',
        'py': 'Yīshēng gěi bìngrén liáng le tǐwēn, fāxiàn tā fāshāo le.',
        'en': 'The doctor measured the patient\'s temperature and found that he had a fever.'
    },
    ('长', 'cháng'): {
        'zh': '这条路很长，我们坐出租车去吧。',
        'py': 'Zhè tiáo lù hěn cháng, wǒmen zuò chūzūchē qù ba.',
        'en': 'This road is very long; let\'s go by taxi.'
    }
}

def load_anki_decks():
    deck_configs = [
        (1, 'anki words/Last_HSK_30_2026_From_official_list_-_HSK_1.apkg'),
        (2, 'anki words/Last_HSK_30_2026_From_official_list_-_HSK_2.apkg'),
        (3, 'anki words/Last_HSK_30_2026_From_official_list_-_HSK_3.apkg'),
        (4, 'anki words/Last_HSK_30_2026_From_official_list_-_HSK_4.apkg'),
        (5, 'anki words/Last_HSK_30_2026_From_official_list_HSK_5.apkg'),
        (6, 'anki words/Last_HSK_30_2026_From_official_list_-_HSK_6.apkg'),
    ]

    hsk3_bands = {i: [] for i in range(1, 7)}
    anki_all_notes = []

    for band, path in deck_configs:
        print(f"Reading Anki Deck Band {band} from {path}...")
        with zipfile.ZipFile(path, 'r') as z:
            db_name = 'collection.anki21' if 'collection.anki21' in z.namelist() else 'collection.anki2'
            with tempfile.NamedTemporaryFile() as tmp:
                tmp.write(z.read(db_name))
                tmp.flush()
                con = sqlite3.connect(tmp.name)
                cur = con.cursor()
                cur.execute('SELECT flds FROM notes')
                rows = cur.fetchall()

                seen_notes = set()

                for (flds_raw,) in rows:
                    flds = flds_raw.split('\x1f')
                    raw_hz = flds[0] if len(flds) > 0 else ''
                    raw_py = flds[1] if len(flds) > 1 else ''
                    raw_pos = flds[2] if len(flds) > 2 else ''
                    raw_meaning = flds[3] if len(flds) > 3 else ''
                    raw_s_zh = flds[4] if len(flds) > 4 else ''
                    raw_s_py = flds[5] if len(flds) > 5 else ''
                    raw_s_en = flds[6] if len(flds) > 6 else ''

                    hz = normalize_hanzi(raw_hz)
                    py = clean_text(raw_py)
                    pos = clean_text(raw_pos)
                    meaning = clean_text(raw_meaning)
                    s_zh = clean_text(raw_s_zh)
                    s_py = clean_text(raw_s_py)
                    s_en = clean_text(raw_s_en)

                    note_sig = (hz, py, s_zh)
                    if note_sig in seen_notes:
                        continue
                    seen_notes.add(note_sig)

                    # Band 1 fix: '看' in Band 1 is kàn
                    if band == 1 and hz == '看':
                        py = 'kàn'
                        meaning = 'to see, to look at, to read, to watch'
                        s_zh = '我喜欢在家里看书。'
                        s_py = 'Wǒ xǐhuan zài jiālǐ kàn shū.'
                        s_en = 'I like reading books at home.'

                    override_ex = LEVEL_APPROPRIATE_SENTENCE_OVERRIDES.get((hz, py))
                    item = {
                        'hanzi': hz,
                        'pinyin': py,
                        'pinyin_sort': normalize_pinyin(py),
                        'meaning': meaning,
                        'version': '3.0',
                        'level': band,
                        'example': override_ex if override_ex else {
                            'zh': s_zh,
                            'py': s_py,
                            'en': s_en
                        }
                    }
                    hsk3_bands[band].append(item)
                    anki_all_notes.append(item)

    # Ensure 炮 and 挨 are present in HSK 3.0 Band 6 as well
    hz_set_band6 = {w['hanzi'] for w in hsk3_bands[6]}
    for extra_hz in ['炮', '挨']:
        if extra_hz not in hz_set_band6:
            cur = CURATED_CUSTOM_ENTRIES[extra_hz]
            item = {
                'hanzi': extra_hz,
                'pinyin': cur['pinyin'],
                'pinyin_sort': normalize_pinyin(cur['pinyin']),
                'meaning': cur['meaning'],
                'version': '3.0',
                'level': 6,
                'example': cur['example']
            }
            hsk3_bands[6].append(item)
            anki_all_notes.append(item)

    return hsk3_bands, anki_all_notes

def load_sentences_json():
    clean_sents = []
    token_map = {}
    if not os.path.exists('data-raw/sentences.json'):
        return clean_sents, token_map

    with open('data-raw/sentences.json', 'r', encoding='utf-8') as f:
        data = json.load(f)

    data.sort(key=lambda s: len(s.get('chinese', '')))

    for s in data:
        zh = clean_text(s.get('chinese', ''))
        py = clean_text(s.get('pinyin', ''))
        en = clean_text(s.get('translation', {}).get('en', ''))

        if not (zh and py and en):
            continue
        if 'placeholder' in en.lower() or '...' in en or 'http' in en:
            continue
        if len(zh) < 4 or len(en) < 4:
            continue

        item = {'zh': zh, 'py': py, 'en': en}
        clean_sents.append(item)

        for t in s.get('tokens', []):
            w = normalize_hanzi(t.get('word', ''))
            if w and w not in token_map:
                token_map[w] = item

    return clean_sents, token_map

def load_tatoeba():
    tatoeba_list = []
    if not os.path.exists('data-raw/cmn_sen_db_2.tsv'):
        return tatoeba_list

    with open('data-raw/cmn_sen_db_2.tsv', 'r', encoding='utf-8') as f:
        for line in f:
            parts = line.strip().split('\t')
            if len(parts) >= 5:
                zh = clean_text(parts[1])
                py = clean_text(parts[3])
                en = clean_text(parts[4])

                if 6 <= len(zh) <= 35 and 15 <= len(en) <= 100:
                    if en[0].isupper() and en[-1] in ('.', '!', '?'):
                        en_lower = en.lower()
                        if not any(bad in en_lower for bad in [
                            'placeholder', 'muiriel', 'tom', 'mary', 'susan', 'alice', 'bob',
                            'http', '@', 'fill the list', 'sign up with', 'crush object',
                            'peaceful night', 'pass away in his sleep', '...'
                        ]):
                            tatoeba_list.append({'zh': zh, 'py': py, 'en': en})
    return tatoeba_list

def main():
    print("==========================================")
    print("REBUILDING HSK DATABASE + POLYPHONE MATRIX")
    print("==========================================")

    hsk3_bands, anki_all_notes = load_anki_decks()
    sents_json_list, sents_json_token_map = load_sentences_json()
    tatoeba_clean = load_tatoeba()

    # Index Anki notes by (hanzi, pinyin_sort) and by hanzi
    anki_by_hz_py = {}
    anki_by_hz = defaultdict(list)
    for n in anki_all_notes:
        anki_by_hz_py[(n['hanzi'], n['pinyin_sort'])] = n
        anki_by_hz[n['hanzi']].append(n)

    # 1. Build & Save HSK 3.0 datasets
    print("\n--- Saving HSK 3.0 Datasets (Bands 1-6) ---")
    os.makedirs('data', exist_ok=True)
    for band in range(1, 7):
        words = hsk3_bands[band]
        words.sort(key=lambda x: (x['pinyin_sort'], x['hanzi']))
        for idx, w in enumerate(words, start=1):
            w['id'] = idx

        out_path = f'data/hsk3_{band}.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(words, f, ensure_ascii=False, indent=2)
        print(f"HSK 3.0 Band {band}: {len(words)} words saved to {out_path}")

    # 2. Build HSK 2.0 datasets
    print("\n--- Processing HSK 2.0 Datasets (Levels 1-6) ---")
    with open('data-raw/complete.min.json', 'r', encoding='utf-8') as f:
        vocab = json.load(f)

    hsk2_levels = {i: [] for i in range(1, 7)}

    for v in vocab:
        raw_hz = v['s']
        hz = normalize_hanzi(raw_hz)
        levels = v.get('l', [])

        raw_forms = v.get('f', [])
        form_pinyin, form_meaning = clean_word_meanings_from_forms(raw_forms, hz)

        old_lvls = [lvl for lvl in levels if lvl in ('o1', 'o2', 'o3', 'o4', 'o5', 'o6')]
        if not old_lvls:
            continue

        lvl_num = min(int(lvl[1]) for lvl in old_lvls)

        override_py = None
        if hz in POLYPHONE_PINYIN_MAP and lvl_num in POLYPHONE_PINYIN_MAP[hz]:
            override_py = POLYPHONE_PINYIN_MAP[hz][lvl_num]

        pinyin = override_py or ''
        meaning = ''
        example = None

        if hz in CURATED_CUSTOM_ENTRIES:
            cur = CURATED_CUSTOM_ENTRIES[hz]
            pinyin = pinyin or cur['pinyin']
            meaning = cur['meaning']
            example = cur['example']
        elif hz in anki_by_hz:
            # Pick best matching Anki note (matching pinyin if override specified)
            matched_anki = None
            if override_py:
                for cand in anki_by_hz[hz]:
                    if cand['pinyin'] == override_py:
                        matched_anki = cand
                        break
                if not matched_anki:
                    ov_norm = normalize_pinyin(override_py)
                    for cand in anki_by_hz[hz]:
                        if cand['pinyin_sort'] == ov_norm:
                            matched_anki = cand
                            break
            if not matched_anki:
                matched_anki = anki_by_hz[hz][0]

            pinyin = pinyin or matched_anki['pinyin']
            meaning = matched_anki['meaning']
            example = matched_anki['example']
        else:
            pinyin = pinyin or form_pinyin
            meaning = form_meaning

            if hz in sents_json_token_map:
                example = sents_json_token_map[hz]
            elif len(hz) >= 4:
                for s in sents_json_list:
                    if hz in s['zh']:
                        example = s
                        break
            if not example and len(hz) >= 2:
                meaning_keywords = set(re.findall(r'[a-zA-Z]{3,}', meaning.lower()))
                for cand in tatoeba_clean:
                    if hz in cand['zh']:
                        if len(hz) >= 4:
                            example = cand
                            break
                        cand_en_words = set(re.findall(r'[a-zA-Z]{3,}', cand['en'].lower()))
                        if meaning_keywords & cand_en_words:
                            example = cand
                            break

            if not example:
                m_short = meaning.split(';')[0].strip() if meaning else hz
                example = {
                    'zh': f'在日常交流中，我们经常使用“{hz}”这个词。',
                    'py': f'Zài rìcháng jiāoliú zhōng, wǒmen jīngcháng shǐyòng "{hz}" zhè ge cí.',
                    'en': f'In daily communication, we often use the word "{hz}" ({m_short}).'
                }

        item = {
            'hanzi': hz,
            'pinyin': pinyin,
            'pinyin_sort': normalize_pinyin(pinyin),
            'meaning': meaning,
            'version': '2.0',
            'level': lvl_num,
            'example': example
        }
        hsk2_levels[lvl_num].append(item)

    # Ensure 炮 and 挨 are in HSK 2.0 Level 6
    hz_set_hsk2_6 = {w['hanzi'] for w in hsk2_levels[6]}
    for extra_hz in ['炮', '挨']:
        if extra_hz not in hz_set_hsk2_6:
            cur = CURATED_CUSTOM_ENTRIES[extra_hz]
            hsk2_levels[6].append({
                'hanzi': extra_hz,
                'pinyin': cur['pinyin'],
                'pinyin_sort': normalize_pinyin(cur['pinyin']),
                'meaning': cur['meaning'],
                'version': '2.0',
                'level': 6,
                'example': cur['example']
            })

    # Index anki notes by (hanzi, exact_pinyin)
    anki_by_hz_exact_py = {}
    for n in anki_all_notes:
        anki_by_hz_exact_py[(n['hanzi'], n['pinyin'])] = n

    hsk2_polyphone_additions = [
        (2, '长', 'cháng'),
        (3, '长', 'zhǎng'),
        (2, '只', 'zhī'),
        (3, '只', 'zhǐ'),
        (2, '还', 'hái'),
        (3, '还', 'huán'),
        (1, '看', 'kàn'),
        (5, '看', 'kān'),
        (2, '得', 'de'),
        (3, '得', 'dé'),
        (3, '得', 'děi'),
        (2, '地', 'de'),
        (3, '地', 'dì'),
        (4, '重', 'zhòng'),
        (5, '重', 'chóng'),
        (4, '空', 'kōng'),
        (4, '空', 'kòng'),
        (5, '处', 'chù'),
        (5, '处', 'chǔ'),
        (5, '调', 'tiáo'),
        (5, '调', 'diào'),
        (5, '系', 'xì'),
        (5, '系', 'jì'),
        (3, '行', 'xíng'),
        (5, '行', 'háng'),
        (4, '当', 'dāng'),
        (5, '当', 'dàng'),
        (4, '倒', 'dào'),
        (5, '倒', 'dǎo'),
        (4, '量', 'liáng'),
        (5, '量', 'liàng'),
        (4, '省', 'shěng'),
        (5, '省', 'xǐng'),
        (4, '数', 'shù'),
        (5, '数', 'shǔ'),
        (4, '转', 'zhuǎn'),
        (6, '转', 'zhuàn'),
        (6, '卷', 'juǎn'),
        (6, '卷', 'juàn'),
        (6, '散', 'sǎn'),
        (6, '散', 'sàn'),
        (6, '吐', 'tǔ'),
        (6, '吐', 'tù'),
        (2, '过', 'guò'),
        (2, '过', 'guo')
    ]

    for tgt_lvl, hz, py_exact in hsk2_polyphone_additions:
        existing = [w for w in hsk2_levels[tgt_lvl] if w['hanzi'] == hz and w['pinyin'] == py_exact]
        if not existing:
            matched_note = anki_by_hz_exact_py.get((hz, py_exact))
            if matched_note:
                ex_note = LEVEL_APPROPRIATE_SENTENCE_OVERRIDES.get((hz, py_exact), matched_note['example'])
                hsk2_levels[tgt_lvl].append({
                    'hanzi': hz,
                    'pinyin': py_exact,
                    'pinyin_sort': normalize_pinyin(py_exact),
                    'meaning': matched_note['meaning'],
                    'version': '2.0',
                    'level': tgt_lvl,
                    'example': ex_note
                })

    # Sort each HSK 2.0 level alphabetically and save
    print("\n--- Saving HSK 2.0 Datasets (Levels 1-6) ---")
    for lvl in range(1, 7):
        words = hsk2_levels[lvl]
        words.sort(key=lambda x: (x['pinyin_sort'], x['hanzi']))
        for idx, w in enumerate(words, start=1):
            w['id'] = idx

        out_path = f'data/hsk2_{lvl}.json'
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(words, f, ensure_ascii=False, indent=2)
        print(f"HSK 2.0 Level {lvl}: {len(words)} words saved to {out_path}")

        alias_path = f'data/hsk{lvl}.json'
        with open(alias_path, 'w', encoding='utf-8') as f:
            json.dump(words, f, ensure_ascii=False, indent=2)

    # 3. Build & Save data/polyphones.json
    print("\n--- Building data/polyphones.json ---")
    poly_30 = defaultdict(list)
    for band in range(1, 7):
        for w in hsk3_bands[band]:
            poly_30[w['hanzi']].append(w)

    poly_20 = defaultdict(list)
    for lvl in range(1, 7):
        for w in hsk2_levels[lvl]:
            poly_20[w['hanzi']].append(w)

    clean_poly_30 = {}
    for hz, items in poly_30.items():
        # Deduplicate identical (pinyin, meaning)
        seen_sig = set()
        distinct = []
        for it in items:
            sig = (it['pinyin'], it['meaning'][:20])
            if sig not in seen_sig:
                seen_sig.add(sig)
                distinct.append(it)
        if len(distinct) > 1:
            clean_poly_30[hz] = distinct

    clean_poly_20 = {}
    for hz, items in poly_20.items():
        seen_sig = set()
        distinct = []
        for it in items:
            sig = (it['pinyin'], it['meaning'][:20])
            if sig not in seen_sig:
                seen_sig.add(sig)
                distinct.append(it)
        if len(distinct) > 1:
            clean_poly_20[hz] = distinct

    poly_master = {
        '3.0': clean_poly_30,
        '2.0': clean_poly_20
    }

    with open('data/polyphones.json', 'w', encoding='utf-8') as f:
        json.dump(poly_master, f, ensure_ascii=False, indent=2)

    print(f"Polyphones index saved to data/polyphones.json: {len(clean_poly_30)} in HSK 3.0, {len(clean_poly_20)} in HSK 2.0.")
    print("==========================================")
    print("REBUILD COMPLETE!")
    print("==========================================")

if __name__ == '__main__':
    main()
