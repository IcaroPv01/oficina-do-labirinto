import json
from typing import List, Dict, Any

class GameContext:
    """
    Representa o estado do jogo na engine (equivalente à cena do GDevelop).
    """
    def __init__(self):
        self.entities: Dict[str, Dict[str, Any]] = {}
        self.global_vars: Dict[str, Any] = {}
        self.action_logs: List[str] = []

    def get_entity(self, entity_id: str):
        return self.entities.get(entity_id)

class Condition:
    def __init__(self, cond_type: str, parameters: Dict[str, Any]):
        self.type = cond_type
        self.parameters = parameters

    def evaluate(self, context: GameContext) -> bool:
        if self.type == "PropertyCompare":
            entity_id = self.parameters.get("entity_id")
            prop = self.parameters.get("property")
            op = self.parameters.get("operator")
            target = self.parameters.get("value")
            
            entity = context.get_entity(entity_id)
            if not entity or prop not in entity:
                return False
                
            val = entity[prop]
            if op == "==": return val == target
            if op == ">": return val > target
            if op == "<": return val < target
            if op == ">=": return val >= target
            if op == "<=": return val <= target
            
        elif self.type == "GlobalVarIsTrue":
            var_name = self.parameters.get("var_name")
            return bool(context.global_vars.get(var_name, False))
            
        return False

class Action:
    def __init__(self, action_type: str, parameters: Dict[str, Any]):
        self.type = action_type
        self.parameters = parameters

    def execute(self, context: GameContext):
        if self.type == "SetProperty":
            entity_id = self.parameters.get("entity_id")
            prop = self.parameters.get("property")
            value = self.parameters.get("value")
            
            entity = context.get_entity(entity_id)
            if entity is not None:
                entity[prop] = value
                context.action_logs.append(f"Action: {entity_id}.{prop} set to {value}")
                
        elif self.type == "SetGlobalVar":
            var_name = self.parameters.get("var_name")
            value = self.parameters.get("value")
            context.global_vars[var_name] = value
            context.action_logs.append(f"Action: GlobalVar '{var_name}' set to {value}")

class Event:
    def __init__(self, data: Dict[str, Any]):
        self.conditions = [
            Condition(c.get("type"), c.get("parameters", {}))
            for c in data.get("conditions", [])
        ]
        self.actions = [
            Action(a.get("type"), a.get("parameters", {}))
            for a in data.get("actions", [])
        ]
        self.sub_events = [
            Event(e) for e in data.get("sub_events", [])
        ]

    def evaluate_and_execute(self, context: GameContext):
        # GDevelop Default: AND logic
        conditions_met = all(cond.evaluate(context) for cond in self.conditions)
                
        if conditions_met or not self.conditions: # Se sem condições, roda a cada frame
            for action in self.actions:
                action.execute(context)
                
            for sub_event in self.sub_events:
                sub_event.evaluate_and_execute(context)

class EventEngine:
    def __init__(self):
        self.events: List[Event] = []

    def load_from_json(self, json_string: str):
        try:
            data = json.loads(json_string)
            self.events = [Event(evt_data) for evt_data in data.get("events", [])]
        except Exception as e:
            print(f"JSON Error: {e}")

    def update(self, context: GameContext):
        for event in self.events:
            event.evaluate_and_execute(context)

if __name__ == "__main__":
    # Exemplo de JSON simulando o save visual
    events_json = '''
    {
      "events": [
        {
          "conditions": [
            {
              "type": "PropertyCompare",
              "parameters": {
                "entity_id": "Player",
                "property": "health",
                "operator": "<=",
                "value": 0
              }
            }
          ],
          "actions": [
            {
              "type": "SetProperty",
              "parameters": {
                "entity_id": "Player",
                "property": "state",
                "value": "dead"
              }
            }
          ]
        }
      ]
    }
    '''
    
    ctx = GameContext()
    ctx.entities = {"Player": {"health": 0, "state": "alive"}}
    
    engine = EventEngine()
    engine.load_from_json(events_json)
    
    print("Estado original:", ctx.entities["Player"])
    engine.update(ctx)
    print("Estado modificado:", ctx.entities["Player"])
