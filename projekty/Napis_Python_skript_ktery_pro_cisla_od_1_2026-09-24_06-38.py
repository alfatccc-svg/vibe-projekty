# Vytvoříme prázdný seznam pro uložení výsledků
moje_vysledky = []

# Pro každé číslo od 1 do 20 (včetně)
for cislo in range(1, 21):
    # Určíme vztah čísla k číslu 10
    if cislo > 10:
        vysledek = f"{cislo} je větší než 10"
    elif cislo < 10:
        vysledek = f"{cislo} je menší než 10"
    else:
        vysledek = f"{cislo} je rovno 10"
    # Výsledek uložíme do seznamu
    moje_vysledky.append(vysledek)
    # Vypíšeme výsledek na obrazovku
    print(vysledek)