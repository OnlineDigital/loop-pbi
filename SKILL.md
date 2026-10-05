---
name: loop-pbi
description: Orchestreaza implementarea continua a unui backlog PBI prin subagenti, cu dependinte, validare, mutare fizica in Done si commit/push. Foloseste cand utilizatorul cere procesarea repetata a backlogului sau invoca loop-pbi; crearea skillului ori simpla organizare a documentatiei nu porneste implementarea.
---

# Loop PBI

Implementeaza backlogul autorizat in valuri de subagenti, pana cand toate PBI-urile din scope sunt efectiv in coloana Done si modificarile sunt validate, comise si publicate prin push. Dupa fiecare task finalizat, integreaza rezultatul, verifica, fa commit si push, apoi continua cu urmatoarele task-uri eligibile. Nu termina dupa primul val si nu cere confirmare pentru continuarea deja autorizata.

## Scope si optiuni

- Invocarea pentru executie a `$loop-pbi`, fara restrangerea scope-ului, cere procesarea tuturor PBI-urilor existente in boardul proiectului curent, inclusiv cele din In Progress. Daca utilizatorul selecteaza IDs, un modul, un milestone, un board sau doar documentatie, limiteaza bucla la acel scope. Nu adauga automat task-uri noi pentru a extinde proiectul.
- Implicit: subagenti cu provider **Codex**, model **6.1-Sol**, reasoning **medium**; commit si push dupa fiecare PBI finalizat. Respecta orice model, reasoning, limita de paralelism, destinatie Git sau exceptie ceruta de utilizator, precum `fara push`.
- Citeste mesajele si deciziile relevante din sesiune, nu doar ultima invocare. Transmite subagentilor toate instructiunile suplimentare aplicabile, inclusiv derogari deja autorizate.
- Lucrul la acest skill, auditul documentatiei sau organizarea boardului nu autorizeaza implementarea backlogului. Pentru scope exclusiv de documentatie, finalizeaza doar PBI-uri de documentatie autorizate; nu porneste artificial PBI-uri de produs.

## Helperul CLI si istoricul Git

Skillul include [scripts/loop-pbi.ts](scripts/loop-pbi.ts), un CLI Bun fara dependinte npm. Citeste [references/cli.md](references/cli.md) inainte de folosire pentru comenzi, configuratie, schema suportata si rollback. Foloseste `scan`/`ready` pentru verificari deterministe si `claim`/`finish` pentru tranzitii, cand schema proiectului este compatibila. `claim` este mutarea in In Progress cu owner si timestamp; nu introduce o baza separata de rezervari. Lockul tranzitiei protejeaza doar impotriva executiilor concurente accidentale.

CLI-ul nu interpreteaza documentatia sau criteriile si nu inlocuieste validatorii locali. Daca intalneste schema necunoscuta, configureaza maparea explicita ori adapteaza helperul; nu considera dependintele necunoscute ca lista goala. `finish` ruleaza verificarile din dovezi si validatorii, cu revenire In Progress daca verificarea finala esueaza. Nu fabrica dovezi pentru a satisface schema CLI-ului.

Citeste [references/git-history.md](references/git-history.md) pentru commituri cautabile dupa ID, investigare prin log/show/blame si recuperarea unui push lipsa. Foloseste istoricul Git drept evidenta durabila a livrarilor; nu crea implicit un CHANGELOG.md sau jurnal duplicat editat concurent. Pastreaza separat doar starea de lucru necesara orchestrarii.

## 1. Descopera proiectul si boardul

1. Identifica radacina Git, branchul, worktree-ul, remote-ul si modificarile existente. Citeste instructiunile furnizate in sesiune si fisierele AGENTS.md aplicabile proiectului, boardului si modulelor atinse, plus instructiunile suplimentare indicate de ele.
2. Foloseste indicatiile utilizatorului si linkurile din README/AGENTS.md pentru a descoperi boardul si documentatia. Cand lipsesc, cauta cu `rg --files`, inclusiv directoarele relevante ignorate de Git daca este necesar, excluzand dependentele si artefactele generate.
3. Nu fixa numele sau capitalizarea folderelor. `PBI/To Do`, `PBIs/To Do`, `pbis/todo`, `backlog/in-progress`, `docs`, `Docs`, `documentation` sunt exemple, nu cai impuse. Construieste o mapa cu **caile reale** pentru radacina boardului, To Do, In Progress, Done, documentatia si validatorii. Pastreaza conventiile locale; nu redenumi sau crea coloane echivalente fara nevoie.
4. Descopera task-urile din coloanele reale, citeste schema locala si extrage identitatea, dependintele, criteriile de acceptare si referintele. Folderul determina amplasarea reala; un camp `status: Done` nu substituie mutarea. Semnaleaza si repara inconsistententele din scope pastrand identitatea si istoricul.
5. Daca exista mai multe boarduri, alege-l pe cel indicat de proiect sau utilizator. Cere o alegere numai cand ambiguitatea reala ar schimba scope-ul; continua intre timp verificarile independente.
6. Descopera comenzile de verificare din instructiuni, package scripts si CI. Ruleaza validatorul boardului existent. Nu inventa un validator sau o optiune de CLI. Citeste documentatia fiecarui modul inainte de implementarea PBI-ului sau deleaga explicit aceasta lectura in brief.

Pastreaza o evidenta compacta: mapa cailor, scope, optiuni de model/Git, IDs si dependinte, ownership, subagenti activi, verificari, commituri/push si blocaje. Dupa compaction sau reluare, reconstruieste starea din disk, Git si task-urile delegate; nu recrea munca activa.

## 2. Rezolva modelul si mecanismul de delegare

- In T3 Code, citeste `orchestrator_capabilities` pentru provider instances, IDs de modele si optiunile reale de reasoning. Rezolva eticheta `6.1-Sol` la ID-ul disponibil in catalog; nu presupune ca eticheta UI este ID-ul API. Rezolva identic orice alegere a utilizatorului.
- Preferi delegarea nativa pentru acelasi provider doar daca suporta modelul si reasoning-ul alese. Daca nu le suporta, foloseste `delegate_task` cu providerInstanceId, model si optiunile din catalog. Nu substitui tacit modelul sau reasoning-ul si nu mosteni accidental modelul orchestratorului.
- Daca toolurile T3 nu apar initial, fa o incercare directa limitata cu numele cunoscut `mcp__t3_code__orchestrator_capabilities`. Daca mediul expune `T3_ACP_MCP_NODE`, foloseste transportul suportat `acp-mcp-call` conform instructiunilor runtime-ului. In alte medii foloseste catalogul si delegarea disponibile acolo.
- Lipsa efectiva a modelului sau a delegarii cerute este un blocaj de capabilitate: raporteaza dovezile si alegerea necesara. Nu crea conversatii top-level pentru a simula subagenti si nu pretinde ca ai delegat daca ai lucrat singur.
- Pentru T3, pastreaza fiecare `taskId`, foloseste `clientRequestId` distinct per task/runda si stabil la retry. Urmareste cu `task_status` si anuleaza cu `task_cancel` cand este necesar. Un timeout de asteptare nu anuleaza task-ul. Nu lansa duplicate cat timp task-ul original este activ.
- Fiecare runda noua de review/reparatie T3 foloseste un nou `delegate_task`, cu brief-ul original, rezultate anterioare si obiectii ramase. `childThreadId` este storage, nu tinta pentru o noua runda prin `t3_thread_send`.

## 3. Alege un val de lucru sigur

1. Inspecteaza mai intai In Progress: identifica munca activa, modificarile si eventualele rezultate recuperabile. Reia task-urile abandonate fara a duplica un agent activ sau a distruge modificarile utilizatorului.
2. Un PBI din To Do este eligibil numai cand toate dependintele sunt finalizate si verificate in coloana Done. Codul aparent existent sau un prerequisite aflat in executie nu reprezinta dependinta satisfacuta.
3. Respecta ordinea locala (de exemplu cel mai mic ID eligibil). Selecteaza cate task-uri independente permit sloturile reale si ownership-ul fisierelor. Independenta in graful PBI nu implica independenta in cod: serializeaza task-urile care ating aceleasi contracte sau fisiere comune, ori stabileste ownership explicit si o integrare controlata.
4. Orchestratorul este singurul care muta fisierele de board, schimba indexuri comune si executa Git in checkout-ul comun. Subagentii implementeaza si furnizeaza dovezi. Un subagent poate muta PBI-ul doar daca are ownership exclusiv explicit si procesul local o cere; orchestratorul reverifica mutarea. Nu permite `git add/commit/push` concurent.
5. Inainte de implementare, asuma PBI-ul, completeaza metadatele cerute si muta-l fizic To Do -> In Progress cu acelasi ID si nume. Verifica sursa absenta si destinatia prezenta si ruleaza validarile locale cerute. Nu copia task-ul si nu suprascrie o destinatie existenta.
6. Deleaga un PBI sau un grup mic de PBI-uri similare si usoare aceluiasi subagent, cu brief complet. Orchestratorul poate grupa 2-4 task-uri cand reutilizeaza contextul, setup-ul si verificarile modulului, au scope clar si nu supraincarca agentul; respecta limitele utilizatorului. Task-urile complexe sau incerte raman delegari individuale. Mai multe PBI-uri independente din grup pot fi In Progress simultan, cu acelasi owner, dar fiecare se asuma, verifica si finalizeaza separat. O dependinta din acelasi grup se implementeaza numai dupa ce prerequisite este verificat si in Done pe boardul canonic, nu doar terminat in branchul copilului. Nu astepta inchiderea intregului val/grup pentru a integra un rezultat disponibil, daca alte modificari active nu ii invalideaza verificarea.

Worktree-ul apartine delegarii/subagentului, nu unui PBI. Pentru o delegare care merita izolarea, CLI-ul creeaza `<proiect>/.worktrees/<delegare>`, de exemplu `vehicles-lite-01`, si adauga `.worktrees/*` in `.gitignore`. Un singur subagent poate implementa mai multe PBI-uri atribuite in acelasi worktree, fara checkout separat per PBI. Pastreaza mapa delegare -> agent/taskId -> worktree/branch -> IDs PBI si ownership exclusiv pe worktree. Nu atribui acelasi PBI mai multor grupuri. Crearea porneste din cod comis; prerequisite necomise din parinte nu apar automat acolo. Boardul canonic ramane la orchestrator, iar copilul nu modifica propria copie istorica a boardului. Nu sterge worktree-uri active, murdare sau neintegrate.

Nu presupune izolarea checkout-ului: subagentii pot partaja acelasi worktree. In T3, `delegate_task` mosteneste workspace-ul parintelui. Accesul la subfolder permite lucrul acolo numai daca toolurile copilului accepta cwd/workdir explicit; cere calea absoluta pentru fiecare operatie si verificarea radacinii Git/branchului inainte de editare. Un `cd` sau `git worktree add` nu schimba binding-ul T3 si nu garanteaza accesul in orice sandbox. Daca runtime-ul nu poate opera explicit in worktree, foloseste checkout-ul comun cu ownership strict. Nu crea threaduri top-level sau muta threadul curent doar pentru a obtine izolare.

In worktree izolat, autorizeaza explicit copilul sa creeze commituri de implementare pe branchul propriu, fara push si fara mutari ale boardului canonic. Pentru grupuri, cere un commit distinct, dovezi si rezultat per PBI; nu amesteca task-uri neterminate in commitul unui task terminat. Integreaza serial in parinte pana la commitul PBI-ului disponibil, in ordinea branchului, verifica rezultatul si creeaza commitul final cu mutarea Done si push per PBI. Nu integra automat intregul varf de branch daca include task-uri neverificate. Pastreaza worktree-ul pana cand toate PBI-urile delegarii sunt integrate si agentul nu il mai foloseste. In checkout comun, Git ramane exclusiv responsabilitatea orchestratorului.

### Brief pentru fiecare subagent

Include aceste informatii, cu cai si valori rezolvate:

- PBI sau grup: pentru fiecare ID, calea actuala din In Progress, obiectiv, criterii, dependinte deja verificate si ownership; indica ordinea si limitele grupului, cu livrare separata per PBI.
- Proiect: radacina/worktree absolut, branch, calea boardului canonic, documentatia modulului si contractele de citit integral; fiecare operatie trebuie sa foloseasca checkout-ul atribuit.
- Instructiuni: continutul sau referintele exacte AGENTS.md, deciziile utilizatorului si limitarile relevante din sesiune. Un subagent T3 nu primeste automat istoricul parintelui.
- Ownership: fisiere/module permise, fisiere comune rezervate orchestratorului, colegii activi; nu anula modificarile altora.
- Verificare: comenzi, probe vizuale/hardware si dovezi obligatorii; fara teste declarate trecute fara executie, fara placeholder prezentat drept functie terminata.
- Livrare: implementare, documentatie afectata, fisiere schimbate, comenzile si rezultatele verificarilor, limitari si blocaje. Nu declara PBI-ul Done doar pe baza raportului si nu executa Git sau mutari de board fara delegare explicita.

## 4. Integreaza, verifica, muta in Done, commit si push

Pentru fiecare rezultat, orchestratorul:

1. Inspecteaza diff-ul si dovezile. Verifica indeplinirea criteriilor, compatibilitatea cu contractele si documentatia. Ruleaza verificarile relevante in starea integrata, inclusiv gate-urile locale obligatorii. Repara esecurile sau deleaga o reparatie inainte de finalizare.
2. Completeaza criteriile, dovezile reale, limitarile, istoricul si metadatele de finalizare cerute. Actualizeaza documentatia si indexurile afectate. Nu reduce criteriile sau gate-urile pentru a goli boardul.
3. Seteaza statusul local corespunzator si **muta fizic** fisierul In Progress -> Done, pastrand identitatea. Verifica existenta unica in Done, absenta din To Do/In Progress si concordanta metadatelor. Finalizeaza checklistul dupa mutare daca regulile o cer.
4. Ruleaza validatorul real al boardului si verificarea specifica de Done daca exista. Exemplu doar pentru un proiect cu acest contract: `& '<cale-reala>/Validate-Board.ps1' -RequireDone '<ID>'`. Daca validatorul sau un criteriu esueaza, corecteaza rezultatul; task-ul incomplet ramane/revine fizic in In Progress cu metadate concordante, fara declaratie de finalizare. Daca nu exista validator, verifica direct invarianta amplasarii unice, metadatele si dependintele.
5. Inspecteaza statusul/diff-ul Git si stage-uieste explicit numai fisierele PBI-ului si integrarea/documentatia aferente, inclusiv mutarea. Pastreaza modificarile utilizatorului si lucrul neterminat al colegilor in afara commitului. Nu folosi indiscriminat `git add .` sau `git add -A` intr-un worktree partajat. Nu folosi reset/clean pentru a fabrica un checkout curat.
6. Fa commit cu ID-ul si rezultatul concret, apoi push pe branchul si remote-ul stabilite. Include trailers `PBI: ID`, `PBI-Phase: integration`, `PBI-Checks`, `PBI-Evidence` si `PBI-Limitations` conform referintei Git; pentru copil phase este `implementation`. Respecta conventiile proiectului si exceptiile utilizatorului. Daca upstream-ul lipseste si destinatia este clara, configureaza-l; nu schimba branchul sau destinatia doar pentru a evita o eroare. Fara force-push, rescrierea istoricului sau bypass de hook-uri.
7. Rezolva autonom erorile recuperabile de Git/teste si conflictele care pot fi rezolvate fara pierderea muncii altora. Inregistreaza commitul si succesul push-ului. Un PBI implementat si validat poate ramane Done daca push-ul este blocat, dar bucla nu este declarata complet livrata; raporteaza distinct starea locala si publicarea.
8. Recalculeaza imediat graful de dependinte si lanseaza urmatoarele PBI-uri eligibile, in limita sloturilor si a ownership-ului sigur.

Daca lucrezi la un PR in T3, inregistreaza URL-ul cu `link_pull_request` cand toolul exista si verifica legaturile inainte de incheiere. Crearea unui PR nu este obligatorie daca utilizatorul a cerut doar commit/push.

### Inchide delegarea si curata worktree-ul

Cleanup-ul este responsabilitatea orchestratorului si se executa dupa fiecare delegare incheiata, nu doar la sfarsitul backlogului. Pentru un grup, asteapta finalizarea tuturor PBI-urilor atribuite; un PBI terminat nu justifica stergerea checkout-ului folosit inca pentru celelalte.

1. Confirma ca subagentul si eventualii copii nu mai lucreaza in checkout. Cere oprirea serverelor/watchers lansate de acea delegare si inchiderea proceselor proprii; nu opri procesele utilizatorului sau ale colegilor. In T3 verifica si pending child runs, nu doar un turn terminal.
2. Integreaza toate commiturile delegarii in branchul parintelui, valideaza si finalizeaza individual PBI-urile pe boardul canonic, comite si confirma push-ul cerut. Pastreaza dovezile utile in fisiere versionate ale proiectului, nu doar in worktree-ul temporar. Cu `fara push`, este suficienta livrarea locala autorizata. Daca exista un PR, respecta strategia ceruta: un PR deschis singur nu inseamna integrare in branchul destinatie.
3. Verifica lista worktree-urilor si mapa delegarii, checkout-ul curat si ancestry: HEAD-ul worktree-ului trebuie sa fie integrat in HEAD-ul parintelui. Ruleaza `bun <skill>/scripts/loop-pbi.ts worktree remove <delegare> --root <proiect>`. CLI-ul face verificari proprii si nu foloseste force.
4. Dupa eliminarea worktree-ului, verifica din nou ca branchul local exact `loop-pbi/<delegare>` este integrat in HEAD-ul parintelui si nu este folosit de alt worktree, apoi ruleaza `git branch -d -- loop-pbi/<delegare>` din parinte. Nu folosi `-D`, nu sterge branchuri ale utilizatorului si nu sterge branchuri remote implicit. Commiturile raman accesibile prin istoricul branchului integrat.
5. Confirma absenta checkout-ului din disk si `git worktree list`, si eliminarea branchului local. Marcheaza delegarea inchisa in evidenta orchestratorului. Pastreaza regula `.worktrees/*` in .gitignore pentru delegarile urmatoare; folderul `.worktrees` gol poate ramane. Nu executa stergeri recursive asupra radacinii `.worktrees` sau cleanup global al worktree-urilor altora.

La un refuz de cleanup, inspecteaza si rezolva cauza recuperabila; nu forta stergerea. Daca agentul este activ, exista modificari nelivrate, push-ul cerut este blocat sau commiturile nu sunt integrate, pastreaza checkout-ul si branchul cu motivul exact si continua alte delegari. Dupa cherry-pick/squash, ancestry poate lipsi: nu presupune ca remove este sigur doar fiindca patchurile par similare. La reluare, reincearca numai cleanup-ul delegarilor deja livrate dupa reverificarea conditiilor; nu recrea commituri sau worktree-uri. Raporteaza la final orice cleanup ramas, separat de PBI-urile finalizate.

## 5. Continua pana la terminare sau blocaj real

Bucla: **redescopera starea -> reia In Progress / selecteaza eligibile -> deleaga -> integreaza si valideaza -> muta in Done -> commit/push -> repeta**.

- Nu te opri dupa un val, un commit, o dificultate obisnuita sau o alegere tehnica de rutina. Ia deciziile reversibile in acord cu cerintele si consemneaza-le. Nu cere din nou permisiunea pentru scope sau push deja autorizate.
- Pentru nelamuriri, citeste mai intai PBI-ul, contractele, testele si istoricul relevant (`log`, `show`, `blame`, `-S`/`-G`). Decide detaliile reversibile si consemneaza presupunerea. Intreaba cand alegerea schimba cerinte confirmate, compatibilitatea sau scope-ul; include context, optiuni si recomandarea, apoi continua task-urile independente.
- Daca un PBI este blocat, pastreaza-l In Progress cu motiv, dovezi si urmatorul pas. Continua cu toate task-urile independente realizabile. Nu transforma un blocaj local intr-un blocaj al intregului backlog.
- Pentru un stopper, consemneaza categoria (dependinta, verificare, mediu/acces, cerinta), incercarile si conditia de deblocare. Pentru erori tranzitorii foloseste cel mult trei incercari consecutive cu asteptari scurte, daca mesajul nu indica deja un blocaj permanent. Pentru esecuri deterministe schimba cauza/abordarea inainte de retry; nu rula la nesfarsit aceeasi comanda. Continua alte task-uri realizabile.
- Daca nu exista task-uri eligibile, verifica dependinte lipsa, cicluri, IDs duplicate, rezultate active si starea reala a boardului. Repara erorile administrative neambigue, dar nu sterge dependinte valide pentru a forta eligibilitatea. Dependintele din afara scope-ului nu autorizeaza extinderea lui.
- Oprirea pentru input/action uman este justificata numai cand nu mai exista progres util in scope si dovezile arata o cerinta pe care agentul nu o poate satisface: acces/credentials, resursa externa indisponibila, alegere care schimba cerinte confirmate sau capabilitate ceruta absenta. Nu repeta la nesfarsit aceeasi incercare fara informatii noi.
- Respecta o cerere ulterioara de oprire/pauza, restrictiile runtime-ului si limitele explicite de resurse. Nu pretinde ca `/loop` creeaza automat un daemon. Foloseste continuarea oferita efectiv de mediu, fara schedule recurent sau thread nou necerut.
- Pentru delegare asincrona T3, asteapta notificarile automate; cand parintele nu mai are lucru util, poate ceda temporar controlul pentru trezire. Aceasta este asteptare, nu finalizarea buclei. La notificare continua acelasi scope; nu lansa pollere sau subagenti duplicati. Foloseste `task_status` cand rezultatul este necesar in timpul lucrului.
- La reluare/compaction, citeste aceasta evidenta, verifica task-urile active si starea Git/boardului si continua de unde ai ramas. Nu promite executie in fundal daca mediul nu o suporta; raporteaza explicit intreruperea tehnica si munca ramasa.

**Conditia de succes:** nu exista PBI-uri din scope in To Do sau In Progress, toate IDs urmarite exista unic in Done, criteriile si validatorii au trecut, nu exista subagenti cu rezultate neintegrate, iar commiturile si push-urile cerute au reusit. Golirea To Do singura nu este succes.

La final raporteaza concis IDs finalizate, linkuri reale din Done, verificarile, commiturile, starea push-ului si cleanup-ul (worktree-uri/branchuri eliminate sau pastrate cu motiv). Daca esti blocat, numeste task-urile ramase, dovada blocajului si exact inputul/actiunea necesara; nu declara backlogul complet.
