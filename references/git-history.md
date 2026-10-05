# Git ca evidenta a livrarilor

Foloseste Git ca istoric durabil al schimbarilor livrate. Nu crea implicit CHANGELOG.md sau un jurnal concurent duplicat. Blocajele si presupunerile inca necomise raman in PBI/evidenta orchestratorului; Git nu inlocuieste boardul, CI-ul sau starea task-urilor active. Daca proiectul cere changelog de release, genereaza-l din intervalul relevant de commituri si editeaza-l pentru publicul tinta.

## Commituri cautabile

Respecta conventia proiectului pentru subject. Foloseste un rezultat concret: `feat(vehicles): add differentiated vehicle classes [PBI 023]`. Corpul explica problema, comportamentul rezultat, deciziile semnificative si verificarile reale. Include trailers simple, pe linii separate:

```text
PBI: 023
PBI-Phase: integration
PBI-Checks: bun test tests/vehicles (PASS); browser probe (PASS)
PBI-Evidence: Docs/Evidence/023/results.json
PBI-Limitations: none
```

Pentru commitul copilului foloseste `PBI-Phase: implementation`; commitul parintelui care include Done foloseste `integration`. Un task poate avea mai multe commituri; nu fabrica relatia 1 PBI = exact 1 commit. Pentru un commit care acopera in mod justificat mai multe PBI-uri, repeta trailerul `PBI: ID` pentru fiecare.

Comenzile si limitarile din commit trebuie sa fie adevarate la acel commit. Nu copia rezultat PASS dinainte de modificari incompatibile. Evidentele relevante sunt fisiere versionate, cu cai relative, fara secrete, credentials sau cai de masina inutile. Nu include propriul hash in commit: hashul se obtine dupa creare. Foloseste fisier temporar pentru mesaj si `git commit -F <file>`, pentru a evita escaping fragil.

## Investigare inainte de implementare

- `git status --short` si `git diff`: separa munca deja existenta de scope-ul nou.
- `git log -n 20 -- <paths>`: afla contractele si deciziile recente ale modulului.
- `git show <commit> -- <paths>`: citeste schimbarea concreta, nu doar mesajul.
- `git blame -L <start>,<end> -- <file>`: identifica provenienta unui contract; apoi citeste commitul si contextul. Blame nu dovedeste cauza unui bug.
- `git log -S <text> -- <paths>` sau `git log -G <pattern> -- <paths>`: cauta introducerea/eliminarea unei reguli sau schimbari de cod.
- `git log --all --fixed-strings --grep="PBI: 023"`: include si branchuri de agent pentru investigare. Prezenta pe un branch copil nu dovedeste integrarea sau push-ul.

Foloseste aceste cautari cand istoricul poate raspunde unei nelamuriri, inainte de a cere utilizatorului explicatii deja consemnate. Nu presupune ca o decizie istorica are prioritate fata de cerintele actuale.

## Stage, commit si push

1. In checkout comun, verifica indexul inainte de stage. Nu include fisiere deja staged de altcineva. Daca ownership-ul staged nu poate fi stabilit, serializeaza integrarea si rezolva explicit, fara reset automat.
2. Stage-uieste numai pathurile exacte ale PBI-ului, inclusiv stergerea sursei si adaugarea destinatiei mutarii. Inspecteaza `git diff --cached --stat` si `git diff --cached`; commitul nu trebuie sa includa alt task neterminat.
3. Executa commitul cu hook-urile active. Dupa commit verifica `git show --stat HEAD` si hashul real. Un commit al copilului nu este dovada finalizarii boardului canonic.
4. Verifica branchul, remote-ul, upstream-ul si modificarile upstream necesare. Foloseste `git fetch <remote>` cand ai nevoie de starea curenta; erorile de retea primesc retry limitat, nu bucla infinita.
5. Push pe destinatia stabilita. Pentru non-fast-forward, inspecteaza divergenta si integreaza conform regulilor proiectului; nu folosi force-push sau rebase automat peste commituri publicate. Munca activa/murdara a colegilor poate impune integrare seriala.
6. La reluare, verifica daca hashul de integrare este deja stramos al HEAD si al remote-tracking ref proaspat actualizat. `git merge-base --is-ancestor <hash> <ref>` este verificarea; hashuri diferite intre HEAD si upstream nu implica singure un push lipsa. `git log <upstream>..HEAD` arata commiturile locale nelivrate pe acel upstream.

Done validat local si push reusit sunt doua stari distincte. Daca publicarea esueaza, pastreaza hashul si destinatia, reincearca publicarea acelui rezultat, fara commit duplicat. Un push reusit nu dovedeste trecerea verificarilor CI.
