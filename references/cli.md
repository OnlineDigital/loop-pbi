# CLI Bun pentru Loop PBI

Citeste aceasta referinta cand folosesti helperul. Necesita Bun; worktree/history necesita si Git. Nu instaleaza pachete npm si nu depinde de Bun Shell sau de un shell particular. Executa procese cu argv arrays si cwd explicit, identic pe Windows/Linux/macOS. Validatorii proiectului pot avea propriile cerinte, de exemplu PowerShell pentru `.ps1`.

Helperul este `../scripts/loop-pbi.ts`, relativ la acest fisier. Ruleaza:

```text
bun "<skill>/scripts/loop-pbi.ts" --help
bun "<skill>/scripts/loop-pbi.ts" scan --root "<proiect>"
bun "<skill>/scripts/loop-pbi.ts" ready --root "<proiect>"
bun "<skill>/scripts/loop-pbi.ts" validate --root "<proiect>"
bun "<skill>/scripts/loop-pbi.ts" claim 023 --agent "agent-023" --root "<proiect>"
bun "<skill>/scripts/loop-pbi.ts" finish 023 --evidence "evidence/023.json" --root "<proiect>"
bun "<skill>/scripts/loop-pbi.ts" worktree create vehicles-lite-01 --root "<proiect>"
bun "<skill>/scripts/loop-pbi.ts" worktree list --root "<proiect>"
bun "<skill>/scripts/loop-pbi.ts" worktree remove vehicles-lite-01 --root "<proiect>"
bun "<skill>/scripts/loop-pbi.ts" history 023 --root "<proiect>"
```

Outputul este JSON; erorile au exit code 1. `scan` raporteaza si erorile fara sa execute validatorii; `ready` refuza boardul inconsistent. `validate` executa si validatorii proiectului. Nicio comanda nu stage-uieste, comite sau publica automat modificari.

## Descoperire si configurare

CLI-ul descopera un singur board cu coloane echivalente `To Do`, `In Progress`, `Done`, ignorand diferente de case, spatii, underscore si cratime. Cauta pana la sase niveluri de directoare, fara directoare ascunse (de exemplu copii `.pbi-validation-*`), dependente si builduri. Pentru boarduri multiple, ascunse, mai adanci sau cu nume diferite, foloseste `--board` sau configura explicit.

Configuratia optionala este `<proiect>/.loop-pbi.json`, sau un fisier dat prin `--config`, aflat in proiect. Creeaz-o numai cand descoperirea/schema implicita nu este suficienta; nu impune configuratie tuturor proiectelor.

```json
{
  "board": "backlog",
  "columns": { "todo": "Pending", "progress": "Active", "done": "Completed" },
  "statuses": { "todo": "To Do", "progress": "In Progress", "done": "Done" },
  "fields": {
    "id": "id", "status": "status", "dependencies": "depends_on",
    "owner": "owner", "started": "started_at", "completed": "completed_at"
  },
  "validate": [["bun", "scripts/validate-board.ts"]],
  "requireDone": [["bun", "scripts/validate-board.ts", "--require-done", "{id}"]]
}
```

Foloseste comenzile reale ale proiectului; exemplul nu creeaza scripturile indicate. Caile coloanelor sunt relative la board; boardul este relativ la proiect. Statusurile implicite sunt numele folderelor. Fiecare comanda este un array de argumente, fara shell interpolation; `{id}` si `{file}` sunt substituite ca valori de argumente. Cwd-ul validatorilor si verificarilor este radacina proiectului.

Daca exista `<board>/Validate-Board.ps1` si `validate` nu este configurat, ruleaza validatorul cu PowerShell, inclusiv `-RequireDone ID` dupa finish. Aceasta este conventia cunoscuta a acestui validator; daca alt proiect are alt contract, configureaza-l explicit. `validate` custom inlocuieste autodetectarea: include toate gate-urile locale obligatorii si nu folosi `[]` ca bypass. Alte scripturi, precum Validate-Plan, se adauga in configuratie sau se ruleaza separat conform instructiunilor locale.

Parserul fara dependinte suporta Markdown cu frontmatter YAML, scalari simpli/quoted si dependinte ca array inline (`["001", "009"]` sau `[]`). Nu este parser YAML general: refuza sintaxe necunoscute in campurile operationale, in loc sa considere task-ul fara dependinte. Pentru dependinte block-style sau declarate in text, citeste contractul proiectului si foloseste override-uri explicite:

```json
{ "dependencies": { "023": ["022", "009"], "044": [] } }
```

Pentru formate care nu au frontmatter, adapteaza helperul/schema explicit; nu rescrie boardul intreg doar pentru a se potrivi CLI-ului. Descoperirea documentatiei si interpretarea criteriilor raman responsabilitatea agentului.

## Claim si finish

`claim` este chiar tranzitia To Do -> In Progress, nu o rezervare separata. Verifica dependintele in Done, scrie owner/started_at/status/completed_at si muta acelasi fisier. Un lock temporar per board serializeaza tranzitiile, pentru cazul accidental in care doua procese incearca acelasi claim. Task-urile deja In Progress nu sunt reasignate automat.

Lockul `.loop-pbi-lock/owner.json` contine PID si ora. Dupa un crash poate ramane lockul sau o tranzitie partiala; inspecteaza procesele, subagentii, fisierul real si metadatele inainte de recuperare. Nu sterge lockuri active pe baza unui timeout arbitrar. CLI-ul nu incearca reparatii automate ale starii partiale.

`finish` necesita un fisier JSON de dovezi existent in proiect:

```json
{
  "id": "023",
  "criteriaSatisfied": true,
  "result": "Catalogul mecanic si integrarea sunt implementate; vezi dovada detaliata din PBI.",
  "limitations": "Niciuna",
  "checks": [["bun", "test", "tests/vehicles"]]
}
```

`criteriaSatisfied` este asumarea agentului dupa review, nu o verificare semantica automata. CLI-ul executa efectiv comenzile din `checks`; exit code diferit de zero blocheaza mutarea. Completeaza mai intai criteriile si dovezile in PBI conform regulilor locale si leaga acest fisier JSON/dovezile detaliate. Verificarile vizuale/hardware nu sunt inlocuite de exit code-ul unui script generic. CLI-ul nu bifeaza automat criteriile si nu fabrica dovezi.

Dupa mutare ruleaza verificarea interna, `afterMove` optional, apoi validatorii finali. `afterMove` contine comenzi locale existente pentru completarea checklistului care trebuie bifat strict dupa mutare, daca proiectul cere asta. Nu configura o comanda care bifeaza criterii de implementare neverificate. Daca verificarea post-mutare esueaza, fisierul revine In Progress cu metadatele anterioare; modificarile din corp/dovezile noi sunt pastrate. Efectele externe ale scripturilor nu sunt anulate de rollback; validatorii ar trebui sa fie read-only.

## Worktree-uri in proiect

`worktree create ASSIGNMENT` creeaza branchul `loop-pbi/ASSIGNMENT` si checkout-ul `<proiect>/.worktrees/ASSIGNMENT`, pornind din HEAD comis sau `--base COMMIT`. ASSIGNMENT este un nume unic al delegarii, precum `vehicles-lite-01`, nu ID-ul unui PBI. Acelasi subagent poate lucra 2-4 PBI-uri similare si usoare in acelasi worktree; CLI-ul nu limiteaza grupul la un singur PBI. Orchestratorul pastreaza lista IDs si ownership-ul, face claim/finish individual si respecta dependintele canonice. Un singur agent detine checkout-ul grupului. Adauga idempotent `.worktrees/*` in `.gitignore` si verifica ignorarea. Nu comite acea modificare automat; orchestratorul o include explicit intr-un commit de infrastructura sau in primul commit PBI potrivit.

Crearea nu copiaza modificarile necomise, fisierele untracked, dependentele instalate sau configuratia locala. Nu considera prerequisite satisfacute daca exista doar in checkout-ul murdar al parintelui. Boardul canonic ramane cel al orchestratorului, nu copia istorica din worktree-ul copilului. Citeste PBI-ul si instructiunile actuale din caile canonice transmise in brief; implementeaza codul in worktree-ul copilului.

Un worktree subdirector poate fi accesibil copilului, dar accesul nu schimba cwd-ul/binding-ul threadului. Cand toolurile copilului accepta `cwd`/`workdir` explicit, instruieste-l sa foloseasca pentru fiecare operatie calea absoluta a worktree-ului si sa verifice `git rev-parse --show-toplevel` si branchul inainte de editare. Nu depinde de un `cd` care ar trebui sa persiste intre tool calls. Daca runtime-ul nu permite operatii explicite in acel checkout, foloseste checkout-ul comun cu ownership; nu simula izolarea prin threaduri top-level necerute.

Copilul poate face commituri de implementare numai in worktree-ul propriu si numai daca brief-ul autorizeaza asta; nu modifica boardul canonic si nu face push. Pentru un grup livreaza commituri, dovezi si rezultate distincte per PBI. Parintele integreaza serial pana la commitul PBI-ului disponibil, in ordinea branchului, verifica codul integrat, finalizeaza acel PBI, face commitul final si push, apoi trece la urmatorul. Nu integra varful branchului daca amesteca rezultate neverificate. Preferi merge fara rescriere de istoric pentru a pastra ancestry si provenienta, conform regulilor proiectului. Inspecteaza staged/unstaged in parinte inainte de merge; nu folosi stash/reset automat peste munca altora. Rezolva conflictele pe baza contractelor, nu alegand mecanic ours/theirs.

`worktree remove ASSIGNMENT` refuza worktree-uri murdare si HEAD-uri care nu sunt stramosi ai HEAD-ului parintelui. Nu foloseste force si pastreaza branchul. Pentru checkout-uri create de versiunea veche, accepta si vechea amplasare `.worktrees/pbi-ASSIGNMENT` daca amplasarea noua nu exista. Dupa cherry-pick, ancestry poate lipsi chiar daca patchul este prezent: refuzul este intentionat; inspecteaza separat inainte de cleanup manual. Nu elimina worktree-ul cat timp agentul care il foloseste este activ sau mai exista rezultate PBI ale grupului neintegrate.

### Cleanup dupa livrarea delegarii

Orchestratorul ruleaza cleanup dupa fiecare grup livrat: agent inactiv, procesele proprii oprite, dovezi pastrate in proiect, toate PBI-urile integrate/validate/comise si push-ul autorizat reusit. `worktree remove` este intentionat o comanda de nivel jos: verifica checkout-ul si ancestry, dar nu cunoaste agentii activi, boardul sau destinatia push-ului; orchestratorul verifica aceste preconditii.

```text
bun "<skill>/scripts/loop-pbi.ts" worktree remove vehicles-lite-01 --root "<proiect>"
git -C "<proiect>" merge-base --is-ancestor loop-pbi/vehicles-lite-01 HEAD
git -C "<proiect>" branch -d -- loop-pbi/vehicles-lite-01
git -C "<proiect>" worktree list
```

Executa sequential si inspecteaza fiecare rezultat: `branch -d` numai dupa succesul remove, dupa verificarea ancestry si dupa confirmarea ca branchul nu este folosit de alt worktree. Nu forta cu `-D` daca Git refuza. Lista finala si verificarea diskului confirma eliminarea checkout-ului. Nu sterge implicit branchuri remote, alte worktree-uri sau radacina `.worktrees`. Regula din .gitignore ramane pentru urmatoarele delegari.

Daca remove/branch delete esueaza, pastreaza locatia, branchul si motivul in evidenta. Continua alte task-uri si reincearca numai dupa rezolvarea cauzei. Nu pierde implementari nelivrate ca sa termini cleanup-ul. Un branch sters dupa integrare nu sterge istoricul PBI-urilor: commiturile sunt accesibile prin branchul parintelui. Pentru reluare idempotenta, inspecteaza mai intai `worktree list` si `git branch --list`; o locatie deja eliminata nu necesita remove din nou.

## Istoric Git ca baza de schimbari

Citeste [git-history.md](git-history.md) pentru commit trailers, query-uri si recuperarea livrarilor. `history ID` cauta exact trailerul `PBI: ID` in branchul curent, fara interpretarea ID-ului ca regex. `history` fara ID listeaza ultimele 50 commituri, ajustabil prin `--limit`. Commiturile vechi fara trailer se cauta prin Git folosind numele taskului, mesajul sau fisierele; CLI-ul nu le ghiceste si nu le modifica.

Testele helperului ruleaza cu `bun test "<skill>/scripts/loop-pbi.test.ts"`, in repos temporare, fara mutatii in proiectul curent.
