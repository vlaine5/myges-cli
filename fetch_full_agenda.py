import subprocess
import datetime
import json
from datetime import datetime, timedelta
from icalendar import Calendar, Event
import pytz
import uuid
import os
import time 

CAMPUS_LOCATIONS = {
    "NATION1": "242 rue du Faubourg Saint Antoine, 75012 Paris",
    "NATION2": "220 rue du Faubourg Saint Antoine, 75012 Paris",
    "VOLTAIRE1": "1 rue Bouvier, 75011 Paris",
    "VOLTAIRE2": "20 rue Bouvier, 75011 Paris",
    "ERARD": "19-21 rue Erard, 75011 Paris",
    "BEAUGRENELLE": "35 quai André Citroen 75015 Paris",
    "MONTSOURIS": "5 rue Lemaignan, 75014 Paris",
    "MONTROUGE": "11 rue Camille Pelletan, 92120 Montrouge",
    "JOURDAN": "6-10 bd Jourdan 75014 Paris",
    "VAUGIRARD": "273-277 rue de Vaugirard, 75012 Paris",
    "MAIN-D-OR": "8-14 Passage de la Main d'Or 75011 Paris",
}

log_file_path = '/app/data/full_agenda.log'
ics_file_path = '/app/data/myges_calendar.ics'

def validate_dates(start_date_str, end_date_str):
    """Valide et ajuste les dates si nécessaire"""
    try:
        start_date = datetime.strptime(start_date_str, '%Y-%m-%d').date()
        end_date = datetime.strptime(end_date_str, '%Y-%m-%d').date()
        
        # Vérification de base des dates
        if start_date > end_date:
            print(f"ATTENTION: Date de début {start_date} après la date de fin, dates inversées")
            start_date, end_date = end_date, start_date
            
        # Vérifier si le mois et le jour sont valides
        if end_date.month == 2 and end_date.day > 28:
            # Ajuster pour février
            end_date = end_date.replace(day=28)
            print(f"ATTENTION: Jour invalide pour février, ajusté à {end_date}")
        
        print(f"Dates validées : du {start_date} au {end_date}")
        return start_date, end_date
        
    except ValueError as e:
        print(f"Erreur de format de date : {e}")
        # Dates par défaut : 6 mois dans le futur
        today = datetime.now().date()
        return today, today + timedelta(days=180)

def clean_string(text):
    """Nettoie une chaîne de caractères"""
    return ' '.join(text.replace('\n', ' ').replace('\r', '').replace('\\', '').split())

def get_raw_agenda(date_str, year):
    """Récupère les données brutes de l'agenda"""
    try:
        formatted_date = f"{date_str}-{year}"  # Format DD-MM-YYYY
        command = f"myges agenda {formatted_date}"
        print(f"Exécution de la commande: {command}")
        result = subprocess.run(command, shell=True, capture_output=True, text=True)
        print(f"Sortie standard: {result.stdout[:200]}...")
        if result.stderr:
            print(f"Erreur: {result.stderr}")
        
        # Si la première commande réussit, exécuter avec --raw
        if "Loading agenda" in result.stdout:
            command_raw = f"myges agenda {formatted_date} --raw"
            result_raw = subprocess.run(command_raw, shell=True, capture_output=True, text=True)
            lines = result_raw.stdout.split('\n')
            if len(lines) > 1:
                try:
                    return json.loads(lines[1])
                except json.JSONDecodeError as e:
                    print(f"Erreur de parsing JSON pour la date {formatted_date}: {e}")
        return None
    except Exception as e:
        print(f"Erreur lors de la récupération de l'agenda pour la date {formatted_date}: {e}")
        return None

def create_event(event_data):
    """Crée un événement ICS à partir des données JSON"""
    try:
        event = Event()
        
        # Conversion des timestamps en datetime
        start_dt = datetime.fromtimestamp(event_data['start_date']/1000, pytz.timezone('Europe/Paris'))
        end_dt = datetime.fromtimestamp(event_data['end_date']/1000, pytz.timezone('Europe/Paris'))
        
        # Informations de base
        event.add('uid', str(uuid.uuid4()))
        event.add('summary', event_data['name'])
        event.add('dtstart', start_dt)
        event.add('dtend', end_dt)
        
        # Gestion de la localisation
        room_info = event_data['rooms'][0] if event_data.get('rooms') else {'name': 'Unknown', 'campus': 'Unknown'}
        campus = room_info.get('campus', 'Unknown')
        room_name = room_info.get('name', 'Unknown')
        address = CAMPUS_LOCATIONS.get(campus, "Adresse inconnue")
        location = clean_string(f"{room_name} ({room_info.get('floor', '')}) - {address}")
        event.add('location', location)
        
        # Récupération des informations de classe et groupe
        classes = event_data.get('classes', [])
        discipline = event_data.get('discipline', {})
        group_name = discipline.get('student_group_name', '')
        
        # Description détaillée
        description = clean_string(
            f"Promotion: {group_name} | "
            f"Salle: {room_name} | "
            f"Groupe: {', '.join(classes)} | "
            f"Campus: {campus} | "
            f"Cours: {event_data['name']} | "
            f"Professeur: {discipline.get('teacher', 'Non spécifié')}"
        )
        event.add('description', description)
        
        # Ajout des catégories et du statut
        event.add('categories', 'COURS')
        event.add('status', 'CONFIRMED')
        event.add('transp', 'OPAQUE')
        
        return event
    except Exception as e:
        print(f"Erreur lors de la création de l'événement : {e}")
        return None

def main():
    # Validation et ajustement des dates
    start_date, end_date = validate_dates(
        os.getenv('START_DATE', '2024-01-01'),
        os.getenv('END_DATE', '2024-12-31')
    )
    
    print(f"Recherche des événements du {start_date} au {end_date}")
    
    # Création du calendrier
    cal = Calendar()
    cal.add('prodid', '-//MyGES Calendar//')
    cal.add('version', '2.0')
    cal.add('calscale', 'GREGORIAN')
    event_count = 0
    
    with open(log_file_path, 'w') as log_file:
        current_date = start_date
        while current_date <= end_date:
            date_str = current_date.strftime("%d-%m")
            year = current_date.strftime("%Y")
            print(f"\nTraitement de la semaine du {date_str}-{year}")
            
            # Récupération des données brutes de l'agenda
            agenda_data = get_raw_agenda(date_str, year)
            
            if agenda_data:
                log_file.write(f"=== Semaine commençant le {date_str}-{year} ===\n")
                log_file.write(json.dumps(agenda_data, indent=2))
                log_file.write("\n\n")
                
                if isinstance(agenda_data, list):
                    for event_data in agenda_data:
                        event = create_event(event_data)
                        if event:
                            cal.add_component(event)
                            event_count += 1
                            print(f"Événement ajouté : {event_data['name']} le {date_str}-{year}")
            else:
                print(f"Aucun événement trouvé pour la semaine du {date_str}-{year}")
            
            current_date += timedelta(days=7)
            time.sleep(1)  # Petit délai pour éviter de surcharger l'API
    
    print(f"\nTotal des événements ajoutés : {event_count}")
    
    # Écriture du fichier ICS
    with open(ics_file_path, 'wb') as ics_file:
        output = cal.to_ical()
        output = output.replace(b'\r\n ', b'').replace(b'\\,', b',')
        ics_file.write(output)
    
    print(f"Agenda complet enregistré dans {log_file_path}")
    print(f"Fichier ICS créé dans {ics_file_path}")

if __name__ == "__main__":
    main()
