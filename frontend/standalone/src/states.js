/* ══════════════════════════════════════════════════════════════════
   STATES — all 36 states and union territories, every one drillable

   The platform is national. Uttarakhand is the district where the
   authoritative registers (shelters, road network, field officers) are
   integrated; every other state runs on the same national model feeds
   at state scope, and says so rather than pretending otherwise.

   Two things are separated deliberately:

     · MODELLED RISK is national. IMD/Open-Meteo, GloFAS, USGS/GDACS,
       INCOIS and FIRMS cover the whole country, so a risk surface can
       be computed for any state honestly.
     · REGISTERS are local. Shelter capacity and road state come from
       an SDMA. Where one is integrated the register reads `sdma`;
       everywhere else it reads `provisional` and the UI marks it, on
       the screen, every time.

   `reg` carries that distinction to the interface. Nothing here is
   allowed to present a provisional register as an authoritative one.

   Zone rosters are real districts and towns of each state, laid out
   roughly west→east (columns A–E) and north→south (rows 1–5), so the
   5×5 grid corresponds to where things actually are.
   ══════════════════════════════════════════════════════════════════ */

/* Terrain drives the physical fields the risk and exposure engines
   read: elevation, slope, and height above nearest drainage. A flood
   score means something different on the Gangetic plain than it does
   in a Himalayan valley, and the exposure overlay (§11) depends on it. */
const TERRAIN = {
  //            elev(m)        slope(°)   HAND(m)     rain24 base
  himalaya:  { e: [780, 3900], s: [16, 48], h: [2, 78],  r: [90, 235] },
  hill:      { e: [280, 1900], s: [10, 36], h: [3, 46],  r: [80, 215] },
  ghats:     { e: [120, 1600], s: [12, 40], h: [2, 52],  r: [95, 260] },
  plain:     { e: [28, 260],   s: [1, 7],   h: [0.8, 16], r: [55, 190] },
  delta:     { e: [1, 26],     s: [0, 3],   h: [0.3, 6],  r: [70, 220] },
  coastal:   { e: [2, 90],     s: [1, 8],   h: [0.5, 12], r: [65, 205] },
  plateau:   { e: [220, 940],  s: [2, 15],  h: [2, 26],   r: [45, 165] },
  desert:    { e: [90, 420],   s: [1, 9],   h: [3, 34],   r: [8, 62] },
  island:    { e: [2, 140],    s: [2, 22],  h: [0.4, 18], r: [70, 230] },
  urban:     { e: [170, 280],  s: [1, 5],   h: [1, 14],   r: [50, 175] }
};

/* ── The register ───────────────────────────────────────────────────
   n    name                       terr  terrain profile
   d    scope label                hz    seeded hazard scores
   pop  population                 pri   the hazard that defines the event
   cst  coastal (tsunami/cyclone)  age   minutes since the event was declared
   reg  'sdma' | 'provisional'     dis   situation label
   z    25 zone names, W→E then N→S
   ─────────────────────────────────────────────────────────────────── */
const ST_PROFILE = {

  ut: { n: 'Uttarakhand', d: 'Chamoli District', pop: '1.14 Cr', cst: 0, terr: 'himalaya',
    hz: { flood: 91, landslide: 84, earthquake: 34, lightning: 26, wildfire: 18 },
    pri: 'flood', age: 212, dis: 'Flood + Landslide', reg: 'sdma', scope: 'district',
    note: 'Alaknanda above danger level at Nandprayag. Two NH-7 slope failures. 14 relief camps activated.',
    z: ['Gwaldam', 'Tharali', 'Dewal', 'Narayanbagar', 'Adibadri',
        'Simli', 'Karnaprayag', 'Gauchar', 'Sonala', 'Ravigram',
        'Langasu', 'Nandprayag', 'Chamoli Town', 'Nauli', 'Kaleshwar',
        'Marwari', 'Birahi', 'Pipalkoti', 'Helang', 'Ghat',
        'Gulabkoti', 'Tapovan', 'Joshimath', 'Reni', 'Sukhi Top'] },

  as: { n: 'Assam', d: 'Assam', pop: '3.5 Cr', cst: 0, terr: 'delta',
    hz: { flood: 88, landslide: 31, earthquake: 47, lightning: 38, wildfire: 12 },
    pri: 'flood', age: 602, dis: 'Flood', reg: 'provisional', scope: 'state',
    note: 'Brahmaputra above danger level at Dhubri and Neamatighat. 38 revenue circles affected, 22 camps open.',
    z: ['Dhubri', 'Kokrajhar', 'Bongaigaon', 'Barpeta', 'Goalpara',
        'Chirang', 'Baksa', 'Nalbari', 'Kamrup', 'Darrang',
        'Udalguri', 'Sonitpur', 'Biswanath', 'Morigaon', 'Nagaon',
        'Lakhimpur', 'Dhemaji', 'Golaghat', 'Jorhat', 'Hojai',
        'Sivasagar', 'Dibrugarh', 'Tinsukia', 'Cachar', 'Karimganj'] },

  br: { n: 'Bihar', d: 'Bihar', pop: '12.7 Cr', cst: 0, terr: 'plain',
    hz: { flood: 76, lightning: 61, heatwave: 34, earthquake: 41, drought: 22 },
    pri: 'flood', age: 502, dis: 'Flood', reg: 'provisional', scope: 'state',
    note: 'Bagmati and Burhi Gandak above warning level. Kosi embankment under continuous watch.',
    z: ['W Champaran', 'E Champaran', 'Sitamarhi', 'Madhubani', 'Supaul',
        'Gopalganj', 'Muzaffarpur', 'Darbhanga', 'Saharsa', 'Araria',
        'Siwan', 'Vaishali', 'Samastipur', 'Madhepura', 'Purnia',
        'Saran', 'Patna', 'Begusarai', 'Khagaria', 'Katihar',
        'Rohtas', 'Nalanda', 'Jehanabad', 'Gaya', 'Bhagalpur'] },

  hp: { n: 'Himachal Pradesh', d: 'Himachal Pradesh', pop: '74 L', cst: 0, terr: 'himalaya',
    hz: { landslide: 82, flood: 58, earthquake: 44, wildfire: 31, lightning: 24 },
    pri: 'landslide', age: 317, dis: 'Landslide', reg: 'provisional', scope: 'state',
    note: 'NH-3 blocked at two points near Mandi. Chandra valley slopes saturated after four days of rain.',
    z: ['Chamba', 'Lahaul', 'Kaza', 'Kinnaur', 'Pooh',
        'Dharamshala', 'Kangra', 'Kullu', 'Manali', 'Reckong Peo',
        'Palampur', 'Hamirpur', 'Mandi', 'Karsog', 'Rampur',
        'Una', 'Bilaspur', 'Sundernagar', 'Shimla', 'Rohru',
        'Nalagarh', 'Solan', 'Nahan', 'Paonta Sahib', 'Renuka'] },

  sk: { n: 'Sikkim', d: 'Sikkim', pop: '6.8 L', cst: 0, terr: 'himalaya',
    hz: { landslide: 79, flood: 62, earthquake: 51, lightning: 18 },
    pri: 'landslide', age: 397, dis: 'Landslide', reg: 'provisional', scope: 'state',
    note: 'Teesta catchment saturated. NH-10 restricted to daylight movement. Glacial lake watch in force.',
    z: ['Dzongu', 'Chungthang', 'Lachen', 'Lachung', 'Yumthang',
        'Mangan', 'Phodong', 'Kabi', 'Tsomgo', 'Nathula',
        'Yuksom', 'Gyalshing', 'Gangtok', 'Rongli', 'Zuluk',
        'Pelling', 'Soreng', 'Singtam', 'Pakyong', 'Rhenock',
        'Dentam', 'Namchi', 'Ravangla', 'Jorethang', 'Melli'] },

  up: { n: 'Uttar Pradesh', d: 'Uttar Pradesh', pop: '24 Cr', cst: 0, terr: 'plain',
    hz: { flood: 68, heatwave: 47, lightning: 44, drought: 26, earthquake: 29 },
    pri: 'flood', age: 532, dis: 'Flood', reg: 'provisional', scope: 'state',
    note: 'Ganga above warning level at Ballia and Ghazipur. Ghaghra rising in the Terai districts.',
    z: ['Saharanpur', 'Bijnor', 'Pilibhit', 'Lakhimpur', 'Bahraich',
        'Muzaffarnagar', 'Moradabad', 'Bareilly', 'Sitapur', 'Gonda',
        'Meerut', 'Aligarh', 'Lucknow', 'Ayodhya', 'Gorakhpur',
        'Mathura', 'Etawah', 'Kanpur', 'Prayagraj', 'Kushinagar',
        'Agra', 'Jhansi', 'Banda', 'Varanasi', 'Ballia'] },

  kl: { n: 'Kerala', d: 'Kerala', pop: '3.5 Cr', cst: 1, terr: 'ghats',
    hz: { landslide: 71, flood: 66, lightning: 32, cyclone: 24, tsunami: 12 },
    pri: 'landslide', age: 447, dis: 'Landslide Watch', reg: 'provisional', scope: 'state',
    note: 'Orange rainfall alert for the hill districts. Antecedent soil moisture near saturation in Wayanad and Idukki.',
    z: ['Kasaragod', 'Kannur', 'Wayanad', 'Sulthan Bathery', 'Nilambur',
        'Thalassery', 'Kozhikode', 'Malappuram', 'Perinthalmanna', 'Palakkad',
        'Guruvayur', 'Thrissur', 'Munnar', 'Idukki', 'Thodupuzha',
        'Aluva', 'Ernakulam', 'Kottayam', 'Pathanamthitta', 'Punalur',
        'Alappuzha', 'Kollam', 'Thiruvananthapuram', 'Neyyattinkara', 'Parassala'] },

  or: { n: 'Odisha', d: 'Odisha', pop: '4.6 Cr', cst: 1, terr: 'coastal',
    hz: { cyclone: 74, flood: 58, lightning: 66, heatwave: 41, tsunami: 19 },
    pri: 'cyclone', age: 702, dis: 'Cyclone Watch', reg: 'provisional', scope: 'state',
    note: 'Deep depression over the Bay of Bengal tracking west-northwest. IMD advisory in force; 879 cyclone shelters on standby.',
    z: ['Sundargarh', 'Jharsuguda', 'Sambalpur', 'Keonjhar', 'Mayurbhanj',
        'Deogarh', 'Bargarh', 'Angul', 'Dhenkanal', 'Balasore',
        'Bolangir', 'Boudh', 'Cuttack', 'Jajpur', 'Bhadrak',
        'Kalahandi', 'Nayagarh', 'Khordha', 'Jagatsinghpur', 'Kendrapara',
        'Koraput', 'Rayagada', 'Ganjam', 'Puri', 'Gopalpur'] },

  wb: { n: 'West Bengal', d: 'West Bengal', pop: '9.9 Cr', cst: 1, terr: 'delta',
    hz: { flood: 69, cyclone: 63, lightning: 52, landslide: 44, tsunami: 16 },
    pri: 'flood', age: 632, dis: 'Flood + Cyclone Watch', reg: 'provisional', scope: 'state',
    note: 'Sundarbans embankments under watch ahead of the depression. Damodar releases raising levels in the lower basin.',
    z: ['Darjeeling', 'Kalimpong', 'Jalpaiguri', 'Alipurduar', 'Cooch Behar',
        'Uttar Dinajpur', 'Dakshin Dinajpur', 'Malda', 'Murshidabad', 'Nadia',
        'Birbhum', 'Bardhaman', 'Durgapur', 'Hooghly', 'Ranaghat',
        'Purulia', 'Bankura', 'Howrah', 'Kolkata', 'North 24 Pgs',
        'Jhargram', 'W Medinipur', 'E Medinipur', 'Diamond Harbour', 'Sundarbans'] },

  mh: { n: 'Maharashtra', d: 'Maharashtra', pop: '12.4 Cr', cst: 1, terr: 'ghats',
    hz: { flood: 64, landslide: 56, drought: 44, lightning: 47, cyclone: 28 },
    pri: 'flood', age: 487, dis: 'Flood', reg: 'provisional', scope: 'state',
    note: 'Panchganga above warning level at Kolhapur. Ghat-section landslide advisories for the Konkan corridor.',
    z: ['Nandurbar', 'Dhule', 'Jalgaon', 'Buldhana', 'Akola',
        'Palghar', 'Nashik', 'Aurangabad', 'Jalna', 'Amravati',
        'Thane', 'Mumbai', 'Ahmednagar', 'Parbhani', 'Nagpur',
        'Raigad', 'Pune', 'Solapur', 'Nanded', 'Wardha',
        'Ratnagiri', 'Satara', 'Kolhapur', 'Chandrapur', 'Gadchiroli'] },

  ml: { n: 'Meghalaya', d: 'Meghalaya', pop: '33 L', cst: 0, terr: 'hill',
    hz: { landslide: 66, flood: 57, earthquake: 43, lightning: 34 },
    pri: 'landslide', age: 422, dis: 'Landslide', reg: 'provisional', scope: 'state',
    note: 'The Cherrapunji belt has taken 380 mm in 24 hours. Slope failures reported on the Shillong–Silchar road.',
    z: ['Ampati', 'Tura', 'Resubelpara', 'Williamnagar', 'Baghmara',
        'Mahendraganj', 'Dalu', 'Rongjeng', 'Nongstoin', 'Mairang',
        'Mawkyrwat', 'Ranikor', 'Shillong', 'Nongpoh', 'Byrnihat',
        'Cherrapunji', 'Mawsynram', 'Pynursla', 'Jowai', 'Khliehriat',
        'Amlarem', 'Dawki', 'Sohra', 'Umiam', 'Ri Bhoi'] },

  ar: { n: 'Arunachal Pradesh', d: 'Arunachal Pradesh', pop: '15 L', cst: 0, terr: 'himalaya',
    hz: { landslide: 61, flood: 52, earthquake: 58, wildfire: 21 },
    pri: 'landslide', age: 292, dis: 'Landslide', reg: 'provisional', scope: 'state',
    note: 'Slope failures on NH-13 and NH-513. Two circles in Dibang Valley temporarily cut off.',
    z: ['Tawang', 'West Kameng', 'East Kameng', 'Kurung Kumey', 'Upper Subansiri',
        'Bomdila', 'Seppa', 'Ziro', 'Daporijo', 'Mechuka',
        'Papum Pare', 'Itanagar', 'Aalo', 'Pasighat', 'Yingkiong',
        'Namsai', 'Tezu', 'Roing', 'Anini', 'Hayuliang',
        'Changlang', 'Miao', 'Khonsa', 'Longding', 'Deomali'] },

  mp: { n: 'Madhya Pradesh', d: 'Madhya Pradesh', pop: '8.5 Cr', cst: 0, terr: 'plateau',
    hz: { lightning: 64, flood: 47, heatwave: 44, drought: 38, wildfire: 29 },
    pri: 'lightning', age: 262, dis: 'Thunderstorm', reg: 'provisional', scope: 'state',
    note: 'Lightning advisory for the Gwalior–Chambal belt and Bundelkhand. Seven fatalities recorded this week.',
    z: ['Sheopur', 'Morena', 'Bhind', 'Datia', 'Chhatarpur',
        'Neemuch', 'Gwalior', 'Shivpuri', 'Tikamgarh', 'Panna',
        'Ratlam', 'Ujjain', 'Guna', 'Sagar', 'Satna',
        'Indore', 'Bhopal', 'Vidisha', 'Jabalpur', 'Rewa',
        'Khargone', 'Khandwa', 'Betul', 'Chhindwara', 'Balaghat'] },

  jk: { n: 'Jammu and Kashmir', d: 'Jammu, Kashmir & Ladakh', pop: '1.6 Cr', cst: 0, terr: 'himalaya',
    hz: { landslide: 58, flood: 49, earthquake: 54, wildfire: 16 },
    pri: 'landslide', age: 372, dis: 'Flash Flood Watch', reg: 'provisional', scope: 'state',
    note: 'Cloudburst risk in the higher reaches. Amarnath route and the Jammu–Srinagar highway under watch.',
    z: ['Kupwara', 'Bandipora', 'Kargil', 'Leh', 'Nubra',
        'Baramulla', 'Ganderbal', 'Sonamarg', 'Zanskar', 'Durbuk',
        'Budgam', 'Srinagar', 'Kishtwar', 'Padum', 'Nyoma',
        'Pulwama', 'Anantnag', 'Doda', 'Ramban', 'Hanle',
        'Poonch', 'Rajouri', 'Udhampur', 'Jammu', 'Kathua'] },

  gj: { n: 'Gujarat', d: 'Gujarat', pop: '7.0 Cr', cst: 1, terr: 'desert',
    hz: { drought: 61, heatwave: 57, cyclone: 44, earthquake: 48, flood: 31 },
    pri: 'drought', age: 762, dis: 'Drought Watch', reg: 'provisional', scope: 'state',
    note: 'Cumulative rainfall 34% below normal for the season to date. Fodder and drinking-water position under weekly review.',
    z: ['Kutch', 'Banaskantha', 'Patan', 'Mehsana', 'Sabarkantha',
        'Lakhpat', 'Morbi', 'Surendranagar', 'Gandhinagar', 'Aravalli',
        'Dwarka', 'Jamnagar', 'Rajkot', 'Ahmedabad', 'Kheda',
        'Porbandar', 'Junagadh', 'Amreli', 'Anand', 'Vadodara',
        'Gir Somnath', 'Bhavnagar', 'Bharuch', 'Surat', 'Valsad'] },

  rj: { n: 'Rajasthan', d: 'Rajasthan', pop: '8.1 Cr', cst: 0, terr: 'desert',
    hz: { drought: 66, heatwave: 71, flood: 24, lightning: 31, wildfire: 22 },
    pri: 'heatwave', age: 762, dis: 'Heatwave + Drought Watch', reg: 'provisional', scope: 'state',
    note: 'Western districts running well below normal rainfall with daytime maxima above the heatwave threshold.',
    z: ['Sri Ganganagar', 'Hanumangarh', 'Churu', 'Jhunjhunu', 'Alwar',
        'Bikaner', 'Nagaur', 'Sikar', 'Dausa', 'Bharatpur',
        'Jaisalmer', 'Jodhpur', 'Ajmer', 'Jaipur', 'Karauli',
        'Barmer', 'Pali', 'Bhilwara', 'Tonk', 'Dholpur',
        'Jalore', 'Sirohi', 'Udaipur', 'Bundi', 'Kota'] },

  ap: { n: 'Andhra Pradesh', d: 'Andhra Pradesh', pop: '5.3 Cr', cst: 1, terr: 'coastal',
    hz: { cyclone: 56, flood: 42, heatwave: 51, lightning: 44, tsunami: 21 },
    pri: 'cyclone', age: 672, dis: 'Cyclone Watch', reg: 'provisional', scope: 'state',
    note: 'Coastal districts on advisory as the depression tracks west-northwest. Fishermen advised not to venture out.',
    z: ['Kurnool', 'Nandyal', 'Srikakulam', 'Vizianagaram', 'Parvathipuram',
        'Anantapur', 'Kadapa', 'Visakhapatnam', 'Anakapalli', 'Alluri',
        'Sri Sathya Sai', 'Annamayya', 'Kakinada', 'Konaseema', 'E Godavari',
        'Chittoor', 'Tirupati', 'Eluru', 'W Godavari', 'Krishna',
        'Nellore', 'Prakasam', 'Bapatla', 'Guntur', 'Palnadu'] },

  ct: { n: 'Chhattisgarh', d: 'Chhattisgarh', pop: '3.0 Cr', cst: 0, terr: 'plateau',
    hz: { lightning: 62, flood: 38, wildfire: 41, heatwave: 39, drought: 27 },
    pri: 'lightning', age: 217, dis: 'Thunderstorm', reg: 'provisional', scope: 'state',
    note: 'Lightning advisory in force for the northern and Bastar divisions. Eleven fatalities statewide this season.',
    z: ['Koriya', 'Surajpur', 'Balrampur', 'Surguja', 'Jashpur',
        'Mungeli', 'Korba', 'Bilaspur', 'Raigarh', 'Sarangarh',
        'Kabirdham', 'Bemetara', 'Baloda Bazar', 'Janjgir', 'Sakti',
        'Rajnandgaon', 'Durg', 'Raipur', 'Mahasamund', 'Gariaband',
        'Kanker', 'Narayanpur', 'Kondagaon', 'Bastar', 'Dantewada'] },

  ka: { n: 'Karnataka', d: 'Karnataka', pop: '6.8 Cr', cst: 1, terr: 'ghats',
    hz: { landslide: 51, flood: 46, drought: 44, lightning: 38, cyclone: 17 },
    pri: 'landslide', age: 407, dis: 'Landslide Watch', reg: 'provisional', scope: 'state',
    note: 'Western Ghats slopes saturated after four days of rain. Shiradi and Charmadi ghat sections under restriction.',
    z: ['Belagavi', 'Bagalkot', 'Vijayapura', 'Kalaburagi', 'Bidar',
        'Uttara Kannada', 'Dharwad', 'Gadag', 'Koppal', 'Raichur',
        'Udupi', 'Shivamogga', 'Haveri', 'Bellary', 'Yadgir',
        'Mangaluru', 'Chikkamagaluru', 'Davanagere', 'Chitradurga', 'Tumakuru',
        'Kodagu', 'Hassan', 'Mandya', 'Mysuru', 'Bengaluru'] },

  tn: { n: 'Tamil Nadu', d: 'Tamil Nadu', pop: '7.8 Cr', cst: 1, terr: 'coastal',
    hz: { cyclone: 48, flood: 44, landslide: 39, heatwave: 42, tsunami: 27 },
    pri: 'cyclone', age: 332, dis: 'Cyclone Watch', reg: 'provisional', scope: 'state',
    note: 'Northeast monsoon systems under watch. Ooty–Coonoor ghat road under intermittent restriction after slips.',
    z: ['Nilgiris', 'Erode', 'Krishnagiri', 'Vellore', 'Tiruvallur',
        'Coimbatore', 'Salem', 'Tiruvannamalai', 'Kanchipuram', 'Chennai',
        'Tiruppur', 'Namakkal', 'Perambalur', 'Villupuram', 'Cuddalore',
        'Dindigul', 'Karur', 'Trichy', 'Thanjavur', 'Nagapattinam',
        'Theni', 'Madurai', 'Sivaganga', 'Ramanathapuram', 'Kanyakumari'] },

  tg: { n: 'Telangana', d: 'Telangana', pop: '3.9 Cr', cst: 0, terr: 'plateau',
    hz: { lightning: 54, flood: 41, heatwave: 58, drought: 36, wildfire: 19 },
    pri: 'heatwave', age: 412, dis: 'Heatwave', reg: 'provisional', scope: 'state',
    note: 'Daytime maxima 4–5 °C above normal across the northern districts. Heat action plan invoked in Hyderabad.',
    z: ['Adilabad', 'Nirmal', 'Mancherial', 'Jagtial', 'Peddapalli',
        'Kamareddy', 'Nizamabad', 'Karimnagar', 'Sircilla', 'Jayashankar',
        'Sangareddy', 'Medak', 'Siddipet', 'Hanamkonda', 'Mulugu',
        'Vikarabad', 'Hyderabad', 'Rangareddy', 'Warangal', 'Kothagudem',
        'Mahabubnagar', 'Nagarkurnool', 'Nalgonda', 'Suryapet', 'Khammam'] },

  jh: { n: 'Jharkhand', d: 'Jharkhand', pop: '3.9 Cr', cst: 0, terr: 'plateau',
    hz: { lightning: 58, flood: 34, drought: 41, heatwave: 44, wildfire: 26 },
    pri: 'lightning', age: 342, dis: 'Thunderstorm', reg: 'provisional', scope: 'state',
    note: 'Lightning is the leading cause of disaster fatality in the state. Advisory for the Chhotanagpur plateau.',
    z: ['Garhwa', 'Palamu', 'Chatra', 'Koderma', 'Sahibganj',
        'Latehar', 'Hazaribagh', 'Giridih', 'Deoghar', 'Godda',
        'Lohardaga', 'Ramgarh', 'Bokaro', 'Dhanbad', 'Dumka',
        'Gumla', 'Ranchi', 'Khunti', 'Jamtara', 'Pakur',
        'Simdega', 'W Singhbhum', 'Saraikela', 'E Singhbhum', 'Jamshedpur'] },

  pb: { n: 'Punjab', d: 'Punjab', pop: '3.0 Cr', cst: 0, terr: 'plain',
    hz: { flood: 44, heatwave: 41, lightning: 27, drought: 24, earthquake: 22 },
    pri: 'flood', age: 288, dis: 'Flood Watch', reg: 'provisional', scope: 'state',
    note: 'Sutlej and Beas releases under watch. Bet-area villages advised to keep livestock on higher ground.',
    z: ['Pathankot', 'Gurdaspur', 'Hoshiarpur', 'Nawanshahr', 'Rupnagar',
        'Amritsar', 'Tarn Taran', 'Kapurthala', 'Jalandhar', 'Mohali',
        'Ferozepur', 'Fazilka', 'Moga', 'Ludhiana', 'Fatehgarh Sahib',
        'Faridkot', 'Muktsar', 'Barnala', 'Sangrur', 'Patiala',
        'Bathinda', 'Mansa', 'Malerkotla', 'Khanna', 'Rajpura'] },

  hr: { n: 'Haryana', d: 'Haryana', pop: '2.9 Cr', cst: 0, terr: 'plain',
    hz: { flood: 41, heatwave: 52, lightning: 26, drought: 29 },
    pri: 'heatwave', age: 254, dis: 'Heatwave', reg: 'provisional', scope: 'state',
    note: 'Maxima above the heatwave threshold across the southern districts. Yamuna levels under routine watch.',
    z: ['Panchkula', 'Ambala', 'Yamunanagar', 'Kurukshetra', 'Karnal',
        'Kaithal', 'Jind', 'Panipat', 'Sonipat', 'Rohtak',
        'Fatehabad', 'Hisar', 'Bhiwani', 'Jhajjar', 'Faridabad',
        'Sirsa', 'Charkhi Dadri', 'Mahendragarh', 'Gurugram', 'Palwal',
        'Ratia', 'Narnaul', 'Rewari', 'Nuh', 'Hathin'] },

  mn: { n: 'Manipur', d: 'Manipur', pop: '32 L', cst: 0, terr: 'hill',
    hz: { landslide: 54, flood: 47, earthquake: 49, lightning: 21 },
    pri: 'landslide', age: 361, dis: 'Landslide Watch', reg: 'provisional', scope: 'state',
    note: 'Hill slopes saturated along NH-2 and NH-37. Imphal valley drainage under watch.',
    z: ['Tamenglong', 'Noney', 'Senapati', 'Kangpokpi', 'Ukhrul',
        'Jiribam', 'Nambol', 'Imphal West', 'Imphal East', 'Kamjong',
        'Pherzawl', 'Bishnupur', 'Thoubal', 'Yairipok', 'Tengnoupal',
        'Churachandpur', 'Moirang', 'Kakching', 'Chandel', 'Moreh',
        'Singngat', 'Thanlon', 'Sugnu', 'Machi', 'Lokchao'] },

  mz: { n: 'Mizoram', d: 'Mizoram', pop: '12 L', cst: 0, terr: 'hill',
    hz: { landslide: 57, flood: 33, earthquake: 44, lightning: 19 },
    pri: 'landslide', age: 298, dis: 'Landslide Watch', reg: 'provisional', scope: 'state',
    note: 'Cut-slope failures reported on the Aizawl–Lunglei road after continuous rain.',
    z: ['Mamit', 'Kolasib', 'Vairengte', 'Saitual', 'Champhai',
        'Zawlnuam', 'Sairang', 'Aizawl', 'Darlawn', 'Khawzawl',
        'Reiek', 'Thenzawl', 'Serchhip', 'Ngopa', 'Biate',
        'Tlabung', 'Lunglei', 'Hnahthial', 'Lawngtlai', 'Chawngte',
        'Bungtlang', 'Saiha', 'Tuipang', 'Phura', 'Sangau'] },

  nl: { n: 'Nagaland', d: 'Nagaland', pop: '22 L', cst: 0, terr: 'hill',
    hz: { landslide: 52, flood: 29, earthquake: 46, wildfire: 24 },
    pri: 'landslide', age: 276, dis: 'Landslide Watch', reg: 'provisional', scope: 'state',
    note: 'Slips reported on NH-29 near Kohima. Dimapur low-lying wards under drainage watch.',
    z: ['Peren', 'Jalukie', 'Dimapur', 'Niuland', 'Mon',
        'Chumoukedima', 'Medziphema', 'Kohima', 'Tseminyu', 'Longleng',
        'Wokha', 'Bhandari', 'Zunheboto', 'Mokokchung', 'Tuli',
        'Phek', 'Pfutsero', 'Meluri', 'Tuensang', 'Changtongya',
        'Chozuba', 'Kiphire', 'Shamator', 'Noklak', 'Aboi'] },

  tr: { n: 'Tripura', d: 'Tripura', pop: '41 L', cst: 0, terr: 'hill',
    hz: { flood: 51, landslide: 44, earthquake: 41, lightning: 34, cyclone: 18 },
    pri: 'flood', age: 322, dis: 'Flood Watch', reg: 'provisional', scope: 'state',
    note: 'Howrah and Gomati rivers above warning level. Low-lying wards of Agartala under watch.',
    z: ['Kanchanpur', 'Dharmanagar', 'Kailashahar', 'Panisagar', 'Kumarghat',
        'Longtharai', 'Ambassa', 'Kamalpur', 'Manu', 'Gandacherra',
        'Khowai', 'Teliamura', 'Jirania', 'Mohanpur', 'Chhamanu',
        'Agartala', 'Bishalgarh', 'Sonamura', 'Melaghar', 'Amarpur',
        'Udaipur', 'Belonia', 'Santirbazar', 'Sabroom', 'Rajnagar'] },

  ga: { n: 'Goa', d: 'Goa', pop: '15 L', cst: 1, terr: 'coastal',
    hz: { flood: 42, landslide: 36, cyclone: 31, lightning: 24, tsunami: 11 },
    pri: 'flood', age: 214, dis: 'Flood Watch', reg: 'provisional', scope: 'state',
    note: 'Mandovi and Zuari catchments running high. Low-lying khazan lands under tidal watch.',
    z: ['Pernem', 'Mandrem', 'Bicholim', 'Sattari', 'Valpoi',
        'Mapusa', 'Bardez', 'Calangute', 'Sanquelim', 'Usgao',
        'Panaji', 'Tiswadi', 'Old Goa', 'Ponda', 'Marcaim',
        'Mormugao', 'Vasco', 'Cortalim', 'Curchorem', 'Sanguem',
        'Margao', 'Salcete', 'Quepem', 'Canacona', 'Betul'] },

  dl: { n: 'Delhi', d: 'NCT of Delhi', pop: '2.1 Cr', cst: 0, terr: 'urban',
    hz: { flood: 46, heatwave: 61, lightning: 22, earthquake: 44, drought: 18 },
    pri: 'heatwave', age: 188, dis: 'Heatwave', reg: 'provisional', scope: 'state',
    note: 'Heat action plan in force. Yamuna at Old Railway Bridge under routine monitoring during releases from Hathnikund.',
    z: ['Narela', 'Alipur', 'Bawana', 'Burari', 'Karawal Nagar',
        'Rohini', 'Model Town', 'Civil Lines', 'Seelampur', 'Shahdara',
        'Punjabi Bagh', 'Karol Bagh', 'Connaught Pl', 'Preet Vihar', 'Vivek Vihar',
        'Janakpuri', 'Rajouri Garden', 'Hauz Khas', 'Daryaganj', 'Patparganj',
        'Dwarka', 'Najafgarh', 'Vasant Kunj', 'Saket', 'Mehrauli'] },

  py: { n: 'Puducherry', d: 'Puducherry', pop: '16 L', cst: 1, terr: 'coastal',
    hz: { cyclone: 44, flood: 38, tsunami: 29, heatwave: 33 },
    pri: 'cyclone', age: 246, dis: 'Cyclone Watch', reg: 'provisional', scope: 'state',
    note: 'Coastal advisory in force for the Puducherry and Karaikal regions. Fishermen advised not to venture out.',
    z: ['Mahe', 'Palloor', 'Pandakkal', 'Chalakkara', 'Yanam',
        'Kurasampeta', 'Mannadipet', 'Villianur', 'Thirunallar', 'Neravy',
        'Lawspet', 'Oulgaret', 'Puducherry', 'Karaikal', 'Kottucherry',
        'Muthialpet', 'Reddiarpalayam', 'Ariyankuppam', 'Nedungadu', 'T.R. Pattinam',
        'Thattanchavady', 'Bahour', 'Nettapakkam', 'Manavely', 'Kirumampakkam'] },

  ch: { n: 'Chandigarh', d: 'Chandigarh', pop: '12 L', cst: 0, terr: 'urban',
    hz: { flood: 31, heatwave: 44, lightning: 21, earthquake: 36 },
    pri: 'heatwave', age: 192, dis: 'Heatwave Advisory', reg: 'provisional', scope: 'state',
    note: 'Sukhna choe and the N-choe drainage under watch during heavy spells. Heat advisory in force.',
    z: ['Sector 1', 'Sector 8', 'Manimajra', 'Sector 26', 'Kishangarh',
        'Sector 15', 'Sector 17', 'Sector 22', 'Sector 32', 'Behlana',
        'Dhanas', 'Sector 34', 'Sector 35', 'Sector 43', 'Hallomajra',
        'Maloya', 'Sector 45', 'Sector 47', 'Burail', 'Ramdarbar',
        'Dadumajra', 'Sector 52', 'Sector 56', 'Badheri', 'Attawa'] },

  dn: { n: 'Dadra and Nagar Haveli', d: 'Dadra & Nagar Haveli', pop: '4.5 L', cst: 0, terr: 'hill',
    hz: { flood: 39, landslide: 24, lightning: 26, heatwave: 34 },
    pri: 'flood', age: 226, dis: 'Flood Watch', reg: 'provisional', scope: 'state',
    note: 'Damanganga catchment under watch. Madhuban dam releases coordinated with Valsad district.',
    z: ['Dadra', 'Rakholi', 'Samarvarni', 'Naroli', 'Amli',
        'Velugam', 'Silvassa', 'Masat', 'Kherdi', 'Athal',
        'Dapada', 'Khanvel', 'Kilvani', 'Sindoni', 'Rudana',
        'Dudhani', 'Galonda', 'Mandoni', 'Chisda', 'Bedpa',
        'Ambabari', 'Kauncha', 'Sili', 'Umbarkoi', 'Kudacha'] },

  dd: { n: 'Daman and Diu', d: 'Daman & Diu', pop: '2.4 L', cst: 1, terr: 'coastal',
    hz: { cyclone: 41, flood: 33, tsunami: 14, heatwave: 31 },
    pri: 'cyclone', age: 268, dis: 'Cyclone Watch', reg: 'provisional', scope: 'state',
    note: 'Arabian Sea system under watch. Fishing fleet advised to remain in harbour.',
    z: ['Diu', 'Ghoghla', 'Bucharwada', 'Vanakbara', 'Nagoa',
        'Saudwadi', 'Fudam', 'Malala', 'Zolawadi', 'Simbor',
        'Nani Daman', 'Moti Daman', 'Devka', 'Jampore', 'Varkund',
        'Bhimpore', 'Dabhel', 'Kachigam', 'Dunetha', 'Kadaiya',
        'Marwad', 'Magarwada', 'Pariyari', 'Dhabel', 'Somnath'] },

  an: { n: 'Andaman and Nicobar Islands', d: 'Andaman & Nicobar', pop: '4.0 L', cst: 1, terr: 'island',
    hz: { tsunami: 58, earthquake: 62, cyclone: 47, flood: 34, landslide: 29 },
    pri: 'earthquake', age: 154, dis: 'Seismic Watch', reg: 'provisional', scope: 'state',
    note: 'Sunda arc seismicity elevated. INCOIS tsunami bulletin status: no threat, monitoring continues.',
    z: ['Diglipur', 'Mayabunder', 'Rangat', 'Long Island', 'Baratang',
        'Kalighat', 'Billiground', 'Kadamtala', 'Havelock', 'Neil',
        'Port Blair', 'Bambooflat', 'Ferrargunj', 'Wandoor', 'Chouldari',
        'Garacharma', 'Prothrapur', 'Hut Bay', 'Tushnabad', 'Manglutan',
        'Car Nicobar', 'Nancowry', 'Kamorta', 'Katchal', 'Campbell Bay'] },

  ld: { n: 'Lakshadweep', d: 'Lakshadweep', pop: '68 K', cst: 1, terr: 'island',
    hz: { cyclone: 44, tsunami: 31, flood: 27 },
    pri: 'cyclone', age: 208, dis: 'Cyclone Watch', reg: 'provisional', scope: 'state',
    note: 'Arabian Sea system under watch. Inter-island vessel movement restricted; sea state very rough.',
    z: ['Bitra', 'Chetlat', 'Kiltan', 'Kadmat', 'Amini',
        'Perumal Par', 'Bangaram', 'Thinnakara', 'Parali', 'Agatti',
        'Kavaratti', 'Suheli', 'Pitti', 'Andrott', 'Kalpeni',
        'Cheriyam', 'Tilakkam', 'Kodithala', 'Viringili', 'Kalpitti',
        'Minicoy', 'Minicoy South', 'Valiyakara', 'Cheriyakara', 'Androth East'] }
};

/* ── The clock is an input, not a decoration ─────────────────────────
   A risk surface that starts from the same figures whichever day and
   hour you open it is not a live surface, it is a screenshot that
   animates. India's hazards are strongly seasonal and partly diurnal,
   and the platform knows what time it is, so the opening state is
   derived from that rather than fixed.

   Monsoon runs June–September; the post-monsoon cyclone season peaks
   October–December on the east coast; heat builds March–June; lightning
   is convective and peaks through the afternoon; a Himalayan river
   responds to the day's melt as well as its rain. None of this is a
   forecast — with a backend attached these values come from the feeds
   and this function is not consulted. It is what makes the offline build
   honest about being live. */
function istNow() {
  const d = new Date();
  /* the deployment's clock, not the viewer's */
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour12: false,
    month: 'numeric', day: 'numeric', hour: 'numeric' }).formatToParts(d);
  const g = k => +p.find(x => x.type === k).value;
  return { month: g('month'), day: g('day'), hour: g('hour') % 24 };
}

/** Seasonal multiplier for a hazard, 0.35 – 1.35. */
function seasonOf(hazard, t) {
  const m = t.month;
  const band = (peak, width, lo, hi) => {
    /* circular distance in months from the peak */
    let d = Math.abs(m - peak); if (d > 6) d = 12 - d;
    return lo + (hi - lo) * Math.max(0, 1 - (d / width) ** 2);
  };
  switch (hazard) {
    case 'flood':      return band(7.5, 3.2, 0.40, 1.30);   // July–August
    case 'landslide':  return band(7.5, 3.0, 0.38, 1.32);
    case 'lightning':  return band(6.0, 3.4, 0.45, 1.20);   // pre-monsoon into monsoon
    case 'cyclone':    return Math.max(band(11, 2.2, 0.35, 1.35),   // post-monsoon, Bay
                                       band(5.5, 1.6, 0.35, 1.05)); // pre-monsoon, Arabian Sea
    case 'heatwave':   return band(5.0, 2.4, 0.30, 1.35);   // April–June
    case 'drought':    return band(4.0, 3.6, 0.55, 1.25);   // deepens through the dry season
    case 'wildfire':   return band(3.5, 2.2, 0.35, 1.30);   // Feb–May forest fire season
    case 'earthquake': return 1;                            // no season
    case 'tsunami':    return 1;
    default:           return 1;
  }
}

/** Time-of-day multiplier, 0.8 – 1.2. */
function diurnalOf(hazard, t) {
  const h = t.hour;
  const peak = (at, width) => 1 + 0.2 * Math.max(0, 1 - (Math.abs(h - at) / width) ** 2);
  switch (hazard) {
    case 'lightning': return peak(16, 6);            // late-afternoon convection
    case 'heatwave':  return peak(15, 6);
    case 'wildfire':  return peak(14, 7);
    case 'flood':     return 0.94 + 0.12 * Math.max(0, 1 - (Math.abs(h - 18) / 9) ** 2);
    default:          return 1;
  }
}

/** What the clock does to a hazard right now. */
function clockFactor(hazard) {
  const t = istNow();
  return seasonOf(hazard, t) * diurnalOf(hazard, t);
}

/** A human sentence for it, so the UI can say why the picture looks as it does. */
function seasonLabel() {
  const m = istNow().month;
  if (m >= 6 && m <= 9) return ['Southwest monsoon', 'Flood and landslide risk is at its seasonal peak.'];
  if (m >= 10 && m <= 12) return ['Post-monsoon', 'Cyclone season on the east coast; the northeast monsoon is over Tamil Nadu.'];
  if (m >= 3 && m <= 5) return ['Pre-monsoon', 'Heat builds, forest-fire season is open, and pre-monsoon thunderstorms are frequent.'];
  return ['Winter', 'The quiet season for most hazards. Cold wave, fog and residual drought dominate.'];
}

/* ── Deterministic per-zone variation ───────────────────────────────
   A hash, not Math.random: the same zone must produce the same terrain
   on every load, or the map would reshuffle itself between renders and
   an operator could never learn the ground. Live movement comes from
   the drift loop on top of this fixed base. */
function zhash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100000) / 100000;
}
const lerp = (a, b, t) => a + (b - a) * t;

/* Zones near the middle of the grid carry more of the event; the corners
   are the state's edges. A real event has a centre. */
function eventWeight(col, row, cx, cy) {
  const d = Math.hypot((col - cx) / 2.6, (row - cy) / 2.6);
  return Math.max(0, 1 - d * 0.62);
}

/**
 * Build the 25-cell operational grid for a state.
 * Shape is identical to what GET /api/risk returns, so the live feed
 * replaces it wholesale without any code change.
 */
function buildStateCells(sid) {
  const P = ST_PROFILE[sid];
  if (!P) return [];
  const T = TERRAIN[P.terr];
  const hazards = Object.keys(P.hz);
  /* the event centre, fixed per state */
  const cx = 1 + zhash(sid + 'cx') * 3, cy = 1 + zhash(sid + 'cy') * 3;

  return P.z.map((name, i) => {
    const col = i % 5, row = (i / 5) | 0;
    const gid = 'ABCDE'[col] + (row + 1);
    const k = zhash(sid + gid + name);
    const k2 = zhash(name + gid);
    const w = eventWeight(col, row, cx, cy);

    const elev = Math.round(lerp(T.e[0], T.e[1], k));
    const slope = Math.round(lerp(T.s[0], T.s[1], (k + k2) / 2));
    const hand = +lerp(T.h[0], T.h[1], k2).toFixed(1);
    const rain = Math.round(lerp(T.r[0], T.r[1], w * 0.7 + k * 0.3));
    /* river gauge ratio only where a cell sits low enough to have one */
    const riv = hand <= 8 ? +(0.72 + w * 0.42 + k2 * 0.1).toFixed(2) : null;

    const risk = {};
    const probability = {};
    const confidence = {};
    for (const h of hazards) {
      const base = P.hz[h];
      /* terrain modulates each hazard differently — a landslide score on
         a 3° slope is not the same claim as one on a 38° slope */
      let mod = 1;
      if (h === 'landslide') mod = 0.45 + (slope / 48) * 0.95;
      else if (h === 'flood') mod = hand <= 3 ? 1.18 : hand <= 8 ? 1.0 : hand <= 20 ? 0.72 : 0.42;
      else if (h === 'heatwave' || h === 'drought') mod = elev > 1500 ? 0.4 : elev > 800 ? 0.72 : 1.05;
      else if (h === 'tsunami' || h === 'cyclone') mod = elev < 40 ? 1.15 : elev < 150 ? 0.78 : 0.35;
      else if (h === 'wildfire') mod = 0.6 + (1 - rain / 260) * 0.8;

      const v = Math.round(Math.max(0, Math.min(100,
        base * mod * (0.55 + w * 0.55) * (0.88 + k * 0.26) * clockFactor(h))));
      risk[h] = v;
      probability[h] = +(v / 100 * 0.86).toFixed(3);
      confidence[h] = +Math.max(0.35, Math.min(0.93,
        (P.reg === 'sdma' ? 0.86 : 0.74) - (riv == null && h === 'flood' ? 0.14 : 0) - k * 0.08
      ).toFixed(2));
    }

    /* population scales with how urban the zone reads: the grid centre of
       a state carries its larger settlements more often than its edges */
    const popBase = { urban: 260000, plain: 96000, delta: 74000, coastal: 62000,
                      plateau: 54000, ghats: 46000, hill: 17000, himalaya: 12000,
                      desert: 34000, island: 7000 }[P.terr];
    const pop = Math.round(popBase * (0.28 + k * 1.9) * (0.7 + w * 0.7));

    return {
      id: gid, cell_id: h3For(sid, i), short: (sid + gid).toUpperCase() + (i * 7 % 97),
      col, row, name,
      risk, probability, confidence,
      pop, elevation_m: elev, slope_deg: slope, hand_m: hand,
      rainfall_24h: rain, rainfall_72h: Math.round(rain * 2.3),
      river_ratio: riv, soil_moisture: +(0.2 + rain / 900).toFixed(2),
      degraded: riv == null ? ['cwc'] : [],
      hist: [-3, -2, -1, 0].map(kk => {
        const o = {}; for (const h of hazards)
          o[h] = Math.max(0, Math.round(risk[h] - (-kk) * (risk[h] > 60 ? 15 : 7)));
        return { t: ago(-kk * 45), ...o };
      })
    };
  });
}

/* A stable pseudo-H3 index per state cell. The real index comes from the
   backend's h3 grid; this keeps the display shape honest offline. */
function h3For(sid, i) {
  const base = (zhash(sid) * 0xfffff | 0).toString(16).padStart(5, '0');
  return '87' + base + (i + 16).toString(16).padStart(2, '0') + 'fffffff'.slice(0, 8);
}

/* ── Registers ──────────────────────────────────────────────────────
   Shelters and roads for a state without an SDMA integration are
   PROVISIONAL: derived from the settlement pattern so the response
   screens are usable, and labelled as provisional wherever they appear.
   They are never described as a verified register. */
const SH_KIND = ['Govt. Inter College', 'Community Hall', 'Relief Camp', 'Primary School',
                 'Panchayat Bhawan', 'Stadium Complex', 'Degree College', 'Cyclone Shelter'];

function buildStateShelters(sid, cells) {
  const P = ST_PROFILE[sid];
  const pick = [...cells].sort((a, b) => b.pop - a.pop).slice(0, 9);
  return pick.map((c, i) => {
    const k = zhash(sid + c.id + 'sh');
    const kind = SH_KIND[(zhash(c.name) * SH_KIND.length) | 0];
    const cap = Math.round(lerp(220, 2100, k));
    const occ = Math.round(cap * lerp(0.12, 0.96, zhash(c.name + 'occ')));
    const water = +lerp(0.6, 7, zhash(c.name + 'w')).toFixed(1);
    const food = +lerp(0.9, 6.5, zhash(c.name + 'f')).toFixed(1);
    const med = Math.round(lerp(0, 6, zhash(c.name + 'm')));
    const state = occ >= cap * 0.9 ? 'full' : k < 0.1 ? 'compromised' : k > 0.88 ? 'standby' : 'open';
    return [`SH-${sid.toUpperCase()}${101 + i}`, `${kind}, ${c.name}`, c.id,
            (c.col + 0.5) / 5, (c.row + 0.5) / 5, cap, occ, water, food, med, state];
  });
}

function buildStateHospitals(sid, cells) {
  const pick = [...cells].sort((a, b) => b.pop - a.pop).slice(0, 3);
  return pick.map((c, i) => [`HOSP-${sid.toUpperCase()}${i + 1}`,
    (i === 0 ? 'District Hospital ' : 'CHC ') + c.name,
    (c.col + 0.5) / 5, (c.row + 0.5) / 5,
    Math.round(lerp(30, 240, zhash(c.name + 'bed'))),
    Math.round(lerp(2, 22, zhash(c.name + 'icu')))]);
}

const ROAD_CAUSE = {
  flood: ['flooded', 'Water over carriageway'], landslide: ['landslide', 'Debris across the carriageway'],
  cyclone: ['blocked', 'Trees down across the road'], earthquake: ['blocked', 'Surface rupture and rockfall'],
  heatwave: ['slow', 'Surface softening, speed restriction'], drought: ['open', 'No restriction'],
  lightning: ['slow', 'Signal outage at the junction'], wildfire: ['blocked', 'Fire across the alignment'],
  tsunami: ['blocked', 'Coastal road inundated']
};

function buildStateRoads(sid, cells) {
  const P = ST_PROFILE[sid];
  const hot = [...cells].sort((a, b) => (b.risk[P.pri] || 0) - (a.risk[P.pri] || 0)).slice(0, 6);
  return hot.map((c, i) => {
    const k = zhash(sid + c.id + 'rd');
    const nm = i % 3 === 0 ? `NH-${10 + ((zhash(c.name) * 60) | 0)}` :
               i % 3 === 1 ? `SH-${4 + ((zhash(c.name) * 40) | 0)}` : 'Link road';
    const [state, reason] = i === 5 ? ['open', 'Reopened after clearance']
      : ROAD_CAUSE[P.pri] || ['slow', 'Restricted movement'];
    return [`${nm} · ${c.name} approach`, state, reason,
            Math.round(lerp(6, 240, k)), `FO-${sid.toUpperCase()}-${p2(i + 1)}`,
            +lerp(0.78, 0.98, k).toFixed(2), c.id];
  });
}

/* ── Official alerts ────────────────────────────────────────────────
   Every alert names a real issuing authority. Which authority depends
   on the hazard, exactly as it does in reality: IMD for meteorological
   warnings, CWC for river stage, INCOIS for the sea, NCS for seismicity,
   and the State Disaster Management Authority for state instructions. */
const ALERT_AUTH = {
  flood: ['Central Water Commission, Flood Forecasting Directorate', 'River in Severe Flood Situation'],
  landslide: ['{SDMA}', 'Landslide Warning'],
  cyclone: ['India Meteorological Department, Cyclone Warning Division', 'Cyclone Alert'],
  earthquake: ['National Center for Seismology', 'Earthquake Information'],
  heatwave: ['India Meteorological Department', 'Heatwave Warning'],
  drought: ['India Meteorological Department', 'Rainfall Deficiency Advisory'],
  lightning: ['India Meteorological Department', 'Thunderstorm with Lightning'],
  wildfire: ['Forest Survey of India / State Forest Department', 'Forest Fire Alert'],
  tsunami: ['INCOIS · Indian Tsunami Early Warning Centre', 'Tsunami Bulletin']
};
const SEV = { 91: 'Extreme', 75: 'Severe', 55: 'Moderate', 0: 'Minor' };
const sevFor = v => SEV[Object.keys(SEV).map(Number).sort((a, b) => b - a).find(k => v >= k)];

function buildStateAlerts(sid, cells) {
  const P = ST_PROFILE[sid];
  /* Severity, order and recency all come from what the hazard is doing
     now — not from the authored baseline. Reading P.hz here is what let a
     February open issue an Extreme rainfall warning for a state scoring
     34, with an age that never moved off seventeen minutes. */
  const live = (typeof S !== 'undefined' && S.states && S.states[sid]) ? S.states[sid].hz : P.hz;
  const order = Object.entries(live).sort((a, b) => b[1] - a[1])
    .filter(([, v]) => v >= 30).slice(0, 4);
  if (!order.length) return [];
  return order.map(([h, v], i) => {
    const [auth, event] = ALERT_AUTH[h];
    const top = [...cells].sort((a, b) => (b.risk[h] || 0) - (a.risk[h] || 0)).slice(0, 2);
    /* Severity is the hazard's severity now. A warning is not Extreme
       because it was authored that way in July. */
    const sev = sevFor(v);
    /* And a severe situation has been warned about recently — an Extreme
       warning issued nine hours ago and never followed up is not what a
       real alerting authority does. */
    const recency = v >= 85 ? [2, 40] : v >= 70 ? [12, 110] : v >= 55 ? [40, 220] : [90, 420];
    const age = Math.round(recency[0] + (recency[1] - recency[0]) * zhash(sid + h + 'a'));
    return {
      id: `CAP-${sid.toUpperCase()}-${p2(i + 1)}${(zhash(sid + h) * 900 | 0) + 100}`,
      auth: auth.replace('{SDMA}', P.n + ' State Disaster Management Authority'),
      sev, urg: v >= 80 ? 'Immediate' : v >= 60 ? 'Expected' : 'Future',
      cert: v >= 80 ? 'Observed' : v >= 60 ? 'Likely' : 'Possible',
      haz: h, event,
      head: alertHead(h, top.map(c => c.name), P.n, sev),
      area: `${top.map(c => c.name).join(', ')} — ${P.n}`,
      age,
      expires_in: Math.round(lerp(4, 24, zhash(sid + h + 'e'))),
      inst: ALERT_INST[h]
    };
  });
}

/* The headline has to scale with the severity. "River above danger level"
   is what a CWC bulletin says when the river is above danger level, not
   what it says about a catchment scoring 34. */
function alertHead(h, where, state, sev) {
  const w = where.join(' and ');
  const high = sev === 'Extreme' || sev === 'Severe';
  const mid = sev === 'Moderate';
  const T = {
    flood: high ? `River above danger level at ${w}`
      : mid ? `River rising towards warning level at ${w}`
      : `River levels being monitored at ${w}`,
    landslide: high ? `High landslide risk on the hill roads around ${w}`
      : mid ? `Slope instability possible around ${w}`
      : `Routine slope monitoring around ${w}`,
    cyclone: high ? `Cyclonic circulation likely to affect ${w}`
      : mid ? `A low-pressure area is being tracked off the ${state} coast`
      : `Sea conditions off ${state} under routine watch`,
    earthquake: high ? `Significant seismic activity recorded near ${w}`
      : mid ? `Moderate seismic activity recorded near ${w}`
      : `Routine seismic monitoring near ${w}`,
    heatwave: high ? `Heatwave conditions very likely over ${w}`
      : mid ? `Daytime temperatures running above normal over ${w}`
      : `Temperatures within seasonal range over ${w}`,
    drought: high ? `Cumulative rainfall well below normal over ${w}`
      : mid ? `Rainfall running below normal over ${w}`
      : `Rainfall being monitored against the long-period average over ${w}`,
    lightning: high ? `Thunderstorm with lightning likely at ${w}`
      : mid ? `Isolated thunderstorms possible at ${w}`
      : `Convective activity being monitored over ${w}`,
    wildfire: high ? `Active fire detections in the forest divisions near ${w}`
      : mid ? `Elevated fire danger in the forest divisions near ${w}`
      : `Forest fire danger within normal limits near ${w}`,
    tsunami: high ? `Tsunami bulletin in force for the ${state} coast`
      : `No tsunami threat. The ${state} coast remains under routine watch`
  };
  return T[h];
}

const ALERT_INST = {
  flood: 'Riverside settlements to move to designated relief camps. Do not cross flooded causeways.',
  landslide: 'Avoid halting below cut slopes. Hill roads restricted to emergency traffic.',
  cyclone: 'Move to a designated cyclone shelter. Secure loose roofing. Fishermen not to venture out.',
  earthquake: 'Drop, cover and hold. Check for structural damage before re-entering buildings.',
  heatwave: 'Avoid outdoor exposure between 12:00 and 16:00. Drink water frequently even without thirst.',
  drought: 'Follow the district water rationing schedule. Report failed handpumps to the block office.',
  lightning: 'Take shelter indoors. Avoid open fields, water bodies and isolated trees.',
  wildfire: 'Do not enter closed forest blocks. Report smoke to the range office immediately.',
  tsunami: 'Move inland and to higher ground. Do not return to the shore until the all-clear is issued.'
};

/* ── Field reports ──────────────────────────────────────────────── */
const REPORT_CAT = {
  flood: ['Water entering houses', 'Water has come into the ground floor near the bridge.'],
  landslide: ['Cracks in ground', 'New cracks have appeared in the lane since morning.'],
  cyclone: ['Roof damage', 'Tin sheets have blown off several houses in the ward.'],
  earthquake: ['Building damage', 'A wall has cracked through in the block near the market.'],
  heatwave: ['Heat illness', 'Two labourers collapsed at the worksite this afternoon.'],
  drought: ['Water shortage', 'The handpump has run dry, we are walking to the next village.'],
  lightning: ['Lightning strike', 'A strike hit the field near the school during the storm.'],
  wildfire: ['Fire spreading', 'Smoke from the ridge is moving towards the settlement.'],
  tsunami: ['Sea coming in', 'The water has come further up the beach than usual.']
};

function buildStateReports(sid, cells) {
  const P = ST_PROFILE[sid];
  const hot = [...cells].sort((a, b) => (b.risk[P.pri] || 0) - (a.risk[P.pri] || 0)).slice(0, 4);
  return hot.map((c, i) => {
    const [cat, desc] = REPORT_CAT[i % 2 === 0 ? P.pri : (Object.keys(P.hz)[1] || P.pri)] || REPORT_CAT.flood;
    const agem = Math.round(lerp(2, 70, zhash(sid + c.id + 'rep')));
    return {
      id: `CR-${sid.toUpperCase()}${40000 + ((zhash(c.name) * 900) | 0)}`,
      cat, loc: c.name, cell: c.id, desc, age: agem, t: ago(agem),
      st: i < 2 ? 'verified' : 'pending',
      by: i < 2 ? `FO-${sid.toUpperCase()}-${p2(i + 1)}` : null
    };
  });
}

/* ── Public API of this module ──────────────────────────────────── */
const stateIds = () => Object.keys(ST_PROFILE);
const stateProfile = id => ST_PROFILE[id];
const isCoastal = id => !!(ST_PROFILE[id] && ST_PROFILE[id].cst);

/** Every state carries a live risk surface. Registers are marked. */
function registerLabel(id) {
  const P = ST_PROFILE[id];
  if (!P) return null;
  return P.reg === 'sdma'
    ? ['SDMA-integrated', 'Shelter and road registers are synchronised with the State Disaster Management Authority.']
    : ['Provisional register', 'Modelled risk here is national and live. The shelter and road registers are provisional pending this state\'s SDMA feed — treat capacity figures as planning estimates, not as a verified register.'];
}
