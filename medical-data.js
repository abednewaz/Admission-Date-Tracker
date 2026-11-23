/* 2026-27 Bangladesh medical colleges. Exam date confirmed; current court status reflects the Appellate Division stay of 23 Nov 2026. */
(function(){
  var publicColleges=["Abdul Malek Ukil Medical College","Bangabandhu Medical College, Sunamganj","Bangabandhu Sheikh Mujib Medical College, Faridpur","Chandpur Medical College","Chattogram Medical College","Colonel Malek Medical College","Cox's Bazar Medical College","Cumilla Medical College","Dhaka Medical College","Jashore Medical College","Khulna Medical College","Kushtia Medical College","M Abdur Rahim Medical College","Sylhet MAG Osmani Medical College","Magura Medical College","Mugda Medical College","Mymensingh Medical College","Naogaon Medical College","Netrokona Medical College","Nilphamari Medical College","Pabna Medical College","Patuakhali Medical College","Rajshahi Medical College","Rangamati Medical College","Rangpur Medical College","Satkhira Medical College","Shaheed M Monsur Ali Medical College","Shaheed Suhrawardy Medical College","Shaheed Syed Nazrul Islam Medical College","Shaheed Taj Uddin Ahmad Medical College","Shaheed Ziaur Rahman Medical College","Sher-E-Bangla Medical College","Sheikh Hasina Medical College, Habiganj","Sheikh Hasina Medical College, Jamalpur","Sheikh Hasina Medical College, Tangail","Sheikh Sayera Khatun Medical College","Sir Salimullah Medical College","Thakurgaon Medical College","Narsingdi Medical College"];
  var privateColleges=["Ad-Din Akij Medical College","Ad-din Momin Medical College","Ad-din Sakina Medical College","Ad-din Sakina Women's Medical College","Ad-din Women's Medical College","Ahsania Mission Medical College","Aichi Medical College","Anwer Khan Modern Medical College","Asgar Ali Medical College","Ashiyan Medical College","Bangladesh Medical College","Barind Medical College","Barister Rafiq-ul-Haq Medical College","Bashundhara Ad-din Medical College","BGC Trust Medical College","Bikrampur Bhuiyan's Medical College","Brahmanbaria Medical College","Care Medical College","Central Medical College","Chattagram International Medical College","Chattagram Maa-O-Shishu Hospital Medical College","City Medical College","Community Based Medical College","Delta Medical College","Dhaka Central International Medical College","Dhaka Community Medical College","Dhaka National Medical College","Diabetic Association Medical College","Dr. Sirajul Islam Medical College","East West Medical College","Eastern Medical College","Enam Medical College and Hospital","Fazlur Rahman Medical College","Gazi Medical College","Gonoshasthaya Samaj Vittik Medical College","Green Life Medical College","Holy Family Red Crescent Medical College","Ibn Sina Medical College","Ibrahim Medical College","Institute of Applied Health Sciences","International Medical College","Islami Bank Medical College","Jahurul Islam Medical College","Jalalabad Ragib-Rabeya Medical College","Khulna City Medical College","Khwaja Yunus Ali Medical College","Kumudini Women's Medical College","Mainamoti Medical College","Marine City Medical College","Marks Medical College","Medical College for Women & Hospital","MH Samorita Medical College","Monno Medical College","Monowara Sikder Medical College","North Bengal Medical College","North East Medical College","Parkview Medical College","Popular Medical College","President Abdul Hamid Medical College","Prime Medical College","Rangpur Community Hospital Medical College","Shahabuddin Medical College","Shaheed Monsur Ali Medical College","South Apollo Medical College","Southern Medical College","Sylhet Women's Medical College","Tairunnessa Memorial Medical College","TMSS Medical College","United Medical College","Universal Medical College and Hospital","US-Bangla Medical College","Uttara Adhunik Medical College","Z. H. Sikder Women's Medical College"];
  function centralMedicalCard(){
    return {
      id:'medical-2026-27-central',
      universityName:'Medical Admission — Central Exam',
      universityShortName:'DGME',
      unit:'MBBS/BDS Admission Test — 2026-27',
      admissionType:'Public / Private',
      applicationOpenDate:'Not published yet',
      applicationDeadline:'Not published yet',
      examDate:'2026-12-18',
      examTime:'Not published yet',
      examLocation:'As per admit card',
      officialUrl:'https://dgme.teletalk.com.bd/',
      status:'Exam date confirmed — Supreme Court stay in effect',
      dateChanged:false,
      previousExamDate:null,
      cycle:'2026-27',
      requirementsStatus:'check_official',
      requirementsSource:'https://dgme.gov.bd/',
      requirements:'Check the official DGME/BMDC admission circular for 2026-27 eligibility and application requirements.',
      requirementsByGroup:{},
      medicalCentral:true,
      medicalColleges:{public:publicColleges,private:privateColleges},
      notes:'Government and private medical colleges use the same centralized MBBS/BDS admission test under DGME. The Appellate Division stayed the High Court order on 23 November 2026, clearing the legal bar on holding public-university and medical admission tests before 31 December. Application dates and other details will be updated after the official 2026-27 circular is published.'
    };
  }
  var extra=[centralMedicalCard()];
  window.ADMISSION_EXAMS=(window.ADMISSION_EXAMS||[]).filter(function(e){
    return e.universityName!=='DGME Combined MBBS / BDS' && !/medical college|medical college and hospital|medical college & hospital/i.test(String(e.universityName||''));
  }).concat(extra);
})();
