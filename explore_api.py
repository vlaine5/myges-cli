import subprocess
import json
import datetime
from datetime import datetime, timedelta
import os

def execute_command(command, raw=True):
    """Exécute une commande myges et retourne le résultat"""
    try:
        full_command = f"myges {command} {'--raw' if raw else ''}"
        print(f"Exécution de: {full_command}")
        result = subprocess.run(
            full_command,
            shell=True,
            capture_output=True,
            text=True
        )
        print(f"Sortie standard: {result.stdout[:200]}...")
        print(f"Sortie d'erreur: {result.stderr[:200]}..." if result.stderr else "Pas d'erreur")
        return result.stdout
    except Exception as e:
        print(f"Erreur lors de l'exécution de {command}: {e}")
        return None

def explore_api():
    """Explore toutes les commandes possibles de l'API MyGES"""
    results = {}
    
    # Liste des commandes de base
    commands = [
        "agenda",
        "courses",
        "grades",
        "absences",
        "projects",
    ]
    
    # Liste des endpoints API à tester
    api_endpoints = [
        "GET /me/profile",
        "GET /me/years",
        "GET /me/nextProjectSteps",
        "GET /me/courses",
        "GET /me/agenda",
    ]
    
    # Exploration des commandes de base
    for cmd in commands:
        print(f"\nExploration de la commande: {cmd}")
        # Capture la sortie formatée
        formatted_output = execute_command(cmd, raw=False)
        # Capture la sortie brute
        raw_output = execute_command(cmd, raw=True)
        
        results[cmd] = {
            "formatted": formatted_output,
            "raw": raw_output
        }
    
    # Exploration des endpoints API directs
    for endpoint in api_endpoints:
        print(f"\nExploration de l'endpoint: {endpoint}")
        command = f"request {endpoint}"
        results[f"api_{endpoint}"] = execute_command(command, raw=True)
    
    # Exploration de l'agenda sur plusieurs périodes
    current_date = datetime.now()
    agenda_dates = []
    
    # Ajouter des dates passées et futures
    for month_offset in range(-3, 12):  # De -3 mois à +12 mois
        test_date = current_date + timedelta(days=30*month_offset)
        agenda_dates.append(test_date.strftime("%d-%m"))
    
    results["agenda_samples"] = {}
    for date_str in agenda_dates:
        print(f"\nExploration de l'agenda pour la date: {date_str}")
        command = f"agenda {date_str}"
        results["agenda_samples"][date_str] = {
            "formatted": execute_command(command, raw=False),
            "raw": execute_command(command, raw=True)
        }
    
    # Sauvegarde des résultats
    output_file = '/app/data/api_exploration.json'
    with open(output_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    
    return results

def analyze_results(results):
    """Analyse les résultats pour trouver des informations intéressantes"""
    print("\nAnalyse des résultats:")
    print("=" * 50)
    
    def explore_dict(d, path="root"):
        """Explore récursivement un dictionnaire pour trouver des champs intéressants"""
        interesting_keywords = ["class", "groupe", "promotion", "student", "year", "discipline", "teacher"]
        
        if isinstance(d, dict):
            for key, value in d.items():
                new_path = f"{path}.{key}"
                if any(keyword in key.lower() for keyword in interesting_keywords):
                    print(f"Champ intéressant trouvé: {new_path} = {value}")
                explore_dict(value, new_path)
        elif isinstance(d, list) and d:
            for i, item in enumerate(d[:1]):  # Explorer seulement le premier élément des listes
                explore_dict(item, f"{path}[{i}]")
    
    for command, data in results.items():
        print(f"\nAnalyse de {command}:")
        print("-" * 30)
        
        try:
            if isinstance(data, str):
                json_data = json.loads(data)
                explore_dict(json_data, command)
            elif isinstance(data, dict):
                explore_dict(data, command)
        except json.JSONDecodeError:
            print(f"Impossible de parser les données JSON pour {command}")
        except Exception as e:
            print(f"Erreur lors de l'analyse de {command}: {e}")

if __name__ == "__main__":
    print("Début de l'exploration complète de l'API MyGES")
    results = explore_api()
    analyze_results(results)
    print("\nExploration terminée. Consultez /app/data/api_exploration.json pour les résultats complets.")