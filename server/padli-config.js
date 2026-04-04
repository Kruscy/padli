/* ============================================================
   PADLI AI – Konfigurációs fájl v2
   ============================================================ */

const config = {

  general: {
    ollamaUrl:       "http://192.168.0.90:11434/api/chat",
    ollamaModel:     "padli-ai",
    maxTokens:       150,
    temperature:     0.7,
    ollamaTimeoutMs: 30000,
  },

  log: {
    dir:       "/opt/padli/logs",
    maxSizeMb: 10,
    maxDays:   30,
  },

  bot: {
    triggerNames:     ["padli"],
    patreonUrl:       "https://www.patreon.com/Padlizsanfansub.hu",
    patreonPriceText: "500 Ft-tól 2000 Ft-ig",
  },

  features: {
    enableTopicMemory:        true,
    enableIntentScoring:      true,
    enableNegation:           true,
    enableCache:              true,
    enableQueryNormalization: true,
    enableLLMSafety:          true,
    enableEdgeCaseHandling:   true,
    enableSecurity:           true,
    enableSynonyms:           true,
    enableAnalytics:          true,
    enableAvoidRepeats:       true,
  },

  intentPriority: ["adult","patreon","availability","dbInfo","recommendation","search"],

  intentScoring: {
    adult:           5.0,
    patreon:         3.0,
    availability:    2.5,
    dbInfo:          2.0,
    recommendation:  2.0,
    offTopicPenalty: -3.0,
    threshold:       1.5,
    logScores:       true,
  },

  negation: {
    enabled: true,
    words:   ["nem","ne","kerülöm","utálom","nem kérek","nem akarok"],
    window:  3,
  },

  normalization: {
    lowercase:      true,
    removeAccents:  true,
    trim:           true,
    collapseSpaces: true,
  },

  cache: {
    enabled:            true,
    ttlMs:              60000,
    maxSize:            500,
    cacheSearchResults: true,
    cacheResponses:     false,
  },

  llmSafety: {
    maxResponseChars:     400,
    stripNewlines:        true,
    enforceSentenceLimit: 3,
    stripSelfName:        true,
  },

  replyDelay: {
    directMentionMs: 0,
    questionMs:      15000,
  },

  antiSpam: {
    spamCooldownMs:       8000,
    maxMessagesPerMinute: 5,
    muteDurationMs:       30000,
    duplicateWindowMs:    5000,
  },

  security: {
    maxInputLength:         300,
    stripHtml:              true,
    preventPromptInjection: true,
    injectionPatterns: ["ignore previous","system:","you are now","forget your","new instructions"],
  },

  edgeCases: {
    emptyReply:    "Írj valamit!",
    emojiReply:    "Haha! Mit szeretnél tudni?",
    gibberishReply: "Nem egész értem – manga vagy anime témában segíthetek!",
  },

  context: {
    enableTopicMemory: true,
    topicExpireMs:     120000,
    followUpBoost:     true,
    maxMessages:       20,
    contextWindow:     6,
  },

  search: {
    fuzzyThreshold:         0.25,
    fuzzyThresholdShort:    0.20,
    shortQueryMaxWords:     2,
  },

  recommendation: {
    maxResults:   3,
    avoidRepeats: true,
  },

  analytics: {
    enabled:             true,
    trackIntents:        true,
    trackMisses:         true,
    trackPopularQueries: true,
  },

  debug: {
    logIntent:       true,
    logIntentScores: true,
    logCacheHits:    true,
  },

  fallback: {
    enabled: true,
    message: "Most kicsit lassú vagyok, próbáld újra pár másodperc múlva!",
  },

  fixedReplies: {
    patreon:  "A PadlizsanFanSub Patreon előfizetés {price} terjed. Előfizetőként azonnal olvashatod az új fejezeteket, és eltűnnek a lakatok! {url}",
    adult:    "Sajnálom ebben nem tudok segíteni, most is egyedül kell csinálnod.",
    noData:   ["Nem vagyok benne biztos.","Erre most nincs biztos infóm.","Ezt nem tudom pontosan.","Sajnos erről nincs adatom."],
    notFound: ["Sajnos a \"{term}\" nincs meg nálunk.","A \"{term}\" jelenleg nem elérhető az oldalon.","Ezt a sorozatot még nem töltöttük fel."],
    found:    ["Igen, a \"{title}\" megvan nálunk – {chaps}!","Fent van! \"{title}\" – {chaps}"],
  },

  systemPrompt: "Te Padli vagy, a PadlizsanFanSub oldal manga/anime asszisztense. Barátsagos, laza közösségi chat bot vagy.\nSZABÁLYOK:\n- MINDIG CSAK MAGYARUL válaszolj\n- 1-2 mondat maximum, természetes csevegős stílus\n- NE kezdd a választ \"Padli!\"-val\n- NE küldj linkeket\n- NE találj ki mangacímeket, karakterneveket vagy konkrét adatokat\n- Ha kapsz [PadliDB (SAJÁT OLDALUNK):...] adatot – ezt emeld ki\n- Ha kapsz [AniList/MAL/stb.] adatot – azt használd\n- Ha valaki hülyéskedik, nyugodtan hülyéskedj vissza – légy természetes\n- Ha valaki off-topic kérdez, lazán reagálj és tereld vissza a témára – NE mereven\n- Ha nincs elég adat: kérdezz vissza természetesen, NE mondd mereven hogy \"nem tudom\"\n- Ha hentai/18+ tartalmat kérnek: \"Sajnálom ebben nem tudok segíteni, most is egyedül kell csinálnod.\"",

  aliases: {
    "snk":"Attack on Titan","aot":"Attack on Titan","shingeki":"Attack on Titan",
    "jjk":"Jujutsu Kaisen","hxh":"Hunter x Hunter",
    "fma":"Fullmetal Alchemist","fmab":"Fullmetal Alchemist Brotherhood",
    "mha":"My Hero Academia","bnha":"My Hero Academia",
    "kny":"Demon Slayer","kimetsu":"Demon Slayer","ds":"Demon Slayer",
    "sao":"Sword Art Online","rezero":"Re:Zero","re zero":"Re:Zero",
    "tpn":"The Promised Neverland","jojo":"JoJo's Bizarre Adventure",
    "dbs":"Dragon Ball Super","dbz":"Dragon Ball Z",
    "csm":"Chainsaw Man","tensura":"That Time I Got Reincarnated as a Slime",
    "slime":"That Time I Got Reincarnated as a Slime",
    "vinland":"Vinland Saga","op":"One Piece",
    "tb":"Tokyo Revengers","tbate":"The Beginning After the End",
  },

  synonyms: {
    "eros":        ["op","overpowered","tul eros","legerosebb","imba"],
    "vicces":      ["humoros","komedia","hahas","poen"],
    "romantikus":  ["szerelmes","romance","szerelem","csajozos"],
    "ijeszto":     ["horror","felelmetes","remiszto"],
    "szomoru":     ["dramai","szivszoritos","erzelmes","melankolikus"],
    "izgalmas":    ["thriller","action","akcio","feszultseg"],
    "kozepiskolai":["school","iskola","diak"],
    "harcmuveszet":["martial arts","kendo","mma"],
    "kalandos":    ["adventure","quest","felfedez"],
    "jatekmechanika":["rpg","system","dungeon","leveling"],
  },

  // FONTOS: a genre nevek pontosan egyeznek a DB genre táblával (nagybetűs)
  // A DB-ben lévő genre-k: Action, Adventure, Comedy, Drama, Ecchi, Fantasy,
  //   Hentai, Horror, Mahou Shoujo, Mystery, Psychological, Romance,
  //   Sci-Fi, Slice of Life, Sports, Supernatural, Thriller
  // Ami NEM genre hanem tag: Isekai, Shounen, Shoujo, Seinen, Martial Arts stb.
  genres: [
    // ── DB GENRE-K (exact match a genre táblával) ──
    { genre:"Romance",       words:["romance","romantik","romantikus","szerelm","szerelem","csajozos","rom-com","romcom","csok","udvarlo","szereto","paros"] },
    { genre:"Fantasy",       words:["fantasy","varazs","magikus","varazsvilag","lovag","sarkan","kiraly","birodalom","kozepkori","magic","elfek","orkok"] },
    { genre:"Action",        words:["action","akcio","harcos","harc","tul eros","overpowered","battle","csata","kuzdo","kuzdes"] },
    { genre:"Adventure",     words:["adventure","kaland","kalandos","felfedez","utazas","quest"] },
    { genre:"Comedy",        words:["comedy","vigjatek","humoros","vicces","komedia","poen","hahas"] },
    { genre:"Drama",         words:["drama","dramai","szomoru","megindito","erzelmes","szivszoritos","tragedia"] },
    { genre:"Horror",        words:["horror","remuletes","ijeszto","felelmetes","zombie","gore"] },
    { genre:"Mystery",       words:["mystery","rejtely","detektiv","nyomozo","krimi","titok"] },
    { genre:"Psychological", words:["psychological","pszichologi","elmejatok","pszichos","mentalis"] },
    { genre:"Thriller",      words:["thriller","feszultseg"] },
    { genre:"Sports",        words:["sports","sport","sportos","foci","kosarlabda","baseball","tenisz","atletika","boxing","box","boxol","okolviv","boksz"] },
    { genre:"Sci-Fi",        words:["sci-fi","scifi","tudomanyos","futurisztikus","urhajo","jovo","technologia"] },
    { genre:"Slice of Life", words:["slice of life","hetkoznap","mindennapi","eletszelet"] },
    { genre:"Supernatural",  words:["supernatural","termeszetfeletti","paranormal","szellem","demonok","angyal","vampir","farkas"] },
    { genre:"Ecchi",         words:["ecchi"] },
    { genre:"Mahou Shoujo",  words:["mahou shoujo","varazslo lany","magical girl"] },

    // ── TAG-EK (a tag táblában keresünk rájuk) ──
    { genre:"Isekai",        words:["isekai","mas vilagba","atkerul","mas vilag","portal"] },
    { genre:"Reincarnation", words:["reincarnation","ujjaszulet","reinkarn","mult elet"] },
    { genre:"Regression",    words:["regression","visszautaz","idoutaz","time travel","masodik esely"] },
    { genre:"Martial Arts",  words:["martial arts","harcmuveszet","kungfu","karate","kendo","judo","mma"] },
    { genre:"School",        words:["school","iskola","iskolas","diak","iskolai","schoolos","tanar"] },
    { genre:"Harem",         words:["harem"] },
    { genre:"Shounen",       words:["shounen","sonen"] },
    { genre:"Shoujo",        words:["shoujo","sodzso"] },
    { genre:"Seinen",        words:["seinen"] },
    { genre:"Josei",         words:["josei"] },
    { genre:"Dungeon",       words:["dungeon","kazamata","labirintus"] },
    { genre:"RPG",           words:["rpg","szintlep","level up","status ablak","system","rendszer","szint","leveling","skill"] },
    { genre:"Tower",         words:["tower","torony","tower of god"] },
    { genre:"Villainess",    words:["villainess","gonosz no","otome","antagonista no"] },
    { genre:"Manhwa",        words:["manhwa","koreai"] },
    { genre:"Manhua",        words:["manhua","kinai"] },
  ],

  patreonTriggers: {
    keywords:  ["patreon","elofizetes","elofizet","tamogat","premium","premiam"],
    priceWith: ["kerul","jon","lakat","fejezet","resz"],
    lockWith:  ["fizet","eltun","ar","nyit"],
  },

  adultTriggers: ["hentai","18+","ecchi","felnott tartalom","adult content","nsfw"],

  mangaAnimeKeywords: [
    "manga","anime","manhwa","manhua","webtoon","ova","ona","film","movie",
    "fejezet","epizod","resz","kotet","sorozat","karakter","foszereplo",
    "padli","patreon","lakat","elofizetes","olvasni","olvashato","nalunk",
    "fent van","ajanl","hasonlo","javasolj","mit olvassak","tag","genre","mufaj",
    "isekai","shounen","shoujo","seinen","fantasy","akcio","horror","romance",
    "naruto","bleach","one piece","dragon ball","attack on titan","demon slayer",
    "jujutsu","solo leveling","berserk","chainsaw","overlord","sword art",
    "re:zero","tensura","slime","death note","tokyo ghoul","frieren",
    "snk","jjk","kny","csm","fma","mha","aot","hxh","sao","tbate",
    "zarolt","hany manga","hany manhwa","hany mu",
  ],

  recommendationTriggers: [
    "ajanl","javasolj","javasl","mit olvassak","mit nezzek","mit ajanlasz",
    "mondj egy","mondj valami","olyan mint","ehhez hasonlo",
  ],

  availabilityTriggers: [
    "nalunk","nalatok","fent van","fenn van","megvan","meg van",
    "elerheto","olvashato","van fent","fent is van","valahol",
    "hol olvashato","hol lehet olvasni","hol tudom olvasni",
    "hol tudom megnezni","hol nezheto","hol talom",
    "fel van toltve","olvassatok",
  ],

  dbInfoTriggers: {
    count:    ["hany manga","hany manhwa","hany mu","mennyi manga","hany darab"],
    tags:     ["milyen tag","milyen genre","milyen mufaj","tagek vannak"],
    knowWith: ["manga","manhwa","mu","sorozat"],
  },

  mediaTypes: {
    movie: ["film","movie","mozi","mozifilm","ova","ona","special","rovidfilm"],
    anime: ["anime","epizod","epizodos","season","evad"],
  },

};

export default config;
